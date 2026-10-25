import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { normalizeTelemetry, TelemetryValidationError } from "./telemetry.js";
import { createWeatherService, parseCoordinates } from "./weather.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(moduleDirectory, "../public");
const brollDirectory = path.resolve(publicDirectory, "assets/broll");
const maximumBodyBytes = 16 * 1024;
const defaultStreamKey = "x";
const streamKeyPattern = /^[a-z0-9][a-z0-9-]{0,15}$/;

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".svg", "image/svg+xml"],
]);

function applySecurityHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(self), payment=()",
  );
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  applySecurityHeaders(response);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function isSameOriginOrNonBrowser(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function hasValidToken(request, expectedToken) {
  if (!expectedToken) return true;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBuffer = Buffer.from(expectedToken);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function streamKeyFrom(url) {
  const streamKey = (url.searchParams.get("stream") ?? defaultStreamKey).toLowerCase();
  return streamKeyPattern.test(streamKey) ? streamKey : null;
}

function createRateLimiter(maximum, windowMs) {
  const clients = new Map();
  return (request) => {
    const now = Date.now();
    const key = request.socket.remoteAddress ?? "unknown";
    const current = clients.get(key);
    if (!current || now >= current.resetAt) {
      clients.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    current.count += 1;
    if (clients.size > 1000) {
      for (const [clientKey, entry] of clients) {
        if (now >= entry.resetAt) clients.delete(clientKey);
      }
    }
    return current.count <= maximum;
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBodyBytes) {
      throw new TelemetryValidationError("request body exceeds 16 KiB");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new TelemetryValidationError("request body must be valid JSON");
  }
}

function requestHostname(request) {
  try {
    return new URL(`http://${request.headers.host ?? "localhost"}`).hostname;
  } catch {
    return "localhost";
  }
}

function createSimulator(publish) {
  let interval = null;
  let step = 0;
  const homeLatitude = -20.16194;
  const homeLongitude = 57.49889;

  function observation() {
    const angle = (step * 8 * Math.PI) / 180;
    const radius = 0.00045 + 0.00012 * Math.sin(step / 6);
    const result = normalizeTelemetry({
      source: "simulator",
      uasId: "LITO-X1-DEMO",
      operatorId: "MUS-DEMO",
      latitude: homeLatitude + Math.cos(angle) * radius,
      longitude: homeLongitude + Math.sin(angle) * radius,
      heightM: 22 + 13 * Math.sin(step / 8),
      groundSpeedMps: 5.5 + 1.8 * Math.cos(step / 5),
      courseDeg: (step * 8 + 90) % 360,
      homeLatitude,
      homeLongitude,
      rssiDbm: -48 - Math.round(Math.abs(Math.sin(step / 7)) * 18),
    });
    step += 1;
    publish(result);
  }

  return {
    get running() {
      return interval !== null;
    },
    start() {
      if (!interval) {
        observation();
        interval = setInterval(observation, 1000);
        interval.unref?.();
      }
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
    },
  };
}

async function serveStatic(requestPath, request, response) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const resolvedPath = path.resolve(publicDirectory, relativePath);
  const relative = path.relative(publicDirectory, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendJson(response, 404, { error: "not found" });
    return;
  }

  try {
    const file = await stat(resolvedPath);
    if (!file.isFile()) {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    let start = 0;
    let end = file.size - 1;
    let status = 200;
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      }
      if (!match || (!match[1] && !match[2]) || start > end || start >= file.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
        response.writeHead(416, { "content-range": `bytes */${file.size}` });
        response.end();
        return;
      }
      status = 206;
    }
    applySecurityHeaders(response);
    response.writeHead(status, {
      "content-type": mimeTypes.get(path.extname(resolvedPath)) ?? "application/octet-stream",
      "content-length": Math.max(0, end - start + 1),
      "accept-ranges": "bytes",
      ...(status === 206 ? { "content-range": `bytes ${start}-${end}/${file.size}` } : {}),
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; frame-src http: https:; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self' https://videos.pexels.com",
    });
    if (request.method === "HEAD" || file.size === 0) response.end();
    else await pipeline(createReadStream(resolvedPath, { start, end }), response);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    throw error;
  }
}

export function createDashboardServer(options = {}) {
  const mediaMtxApiUrl =
    options.mediaMtxApiUrl === undefined
      ? process.env.MEDIAMTX_API_URL ?? "http://127.0.0.1:9997"
      : options.mediaMtxApiUrl;
  const telemetryToken = options.telemetryToken ?? process.env.TELEMETRY_TOKEN ?? null;
  const allowTelemetryRequest = createRateLimiter(1200, 60_000);
  const allowSimulatorRequest = createRateLimiter(60, 60_000);
  const allowWeatherRequest = createRateLimiter(60, 60_000);
  const weatherFor = createWeatherService(options.weatherOptions);
  const searchPlaces = options.searchPlaces ?? (async (query) => {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({ name: query, count: "5", language: "en", format: "json" }).toString();
    const result = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!result.ok) throw new Error("Location lookup failed");
    const body = await result.json();
    return (Array.isArray(body.results) ? body.results : []).filter((place) =>
      typeof place.name === "string" && Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
      .slice(0, 5).map((place) => ({ name: place.name, region: place.admin1 ?? "", country: place.country ?? "", latitude: place.latitude, longitude: place.longitude }));
  });
  const sseClients = new Map();
  const latestTelemetry = new Map();

  function publish(telemetry, streamKey = defaultStreamKey) {
    latestTelemetry.set(streamKey, telemetry);
    const message = `event: telemetry\ndata: ${JSON.stringify(telemetry)}\n\n`;
    for (const [client, clientStreamKey] of sseClients) {
      if (clientStreamKey === streamKey) client.write(message);
    }
  }

  const simulators = new Map();
  function simulatorFor(streamKey) {
    if (!simulators.has(streamKey)) {
      simulators.set(streamKey, createSimulator((telemetry) => publish(telemetry, streamKey)));
    }
    return simulators.get(streamKey);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/api/weather") {
        let coordinates;
        try { coordinates = parseCoordinates(url.searchParams.get("latitude"), url.searchParams.get("longitude")); }
        catch (error) { sendJson(response, 400, { error: error.message }); return; }
        if (!allowWeatherRequest(request)) { sendJson(response, 429, { error: "Try again in a minute." }); return; }
        try { sendJson(response, 200, await weatherFor(coordinates)); }
        catch { sendJson(response, 503, { error: "Weather unavailable. No flight assessment can be made. Check your internet connection and try again." }); }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/places") {
        const query = (url.searchParams.get("q") ?? "").trim();
        if (query.length < 3 || query.length > 80) { sendJson(response, 400, { error: "Enter at least three letters for a place." }); return; }
        if (!allowWeatherRequest(request)) { sendJson(response, 429, { error: "Try again in a minute." }); return; }
        try { sendJson(response, 200, { places: await searchPlaces(query) }); }
        catch { sendJson(response, 503, { error: "Place search is unavailable." }); }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/config") {
        const streamKey = streamKeyFrom(url);
        if (!streamKey) {
          sendJson(response, 400, { error: "invalid stream key" });
          return;
        }
        const hostname = requestHostname(request);
        const bracketedHost = hostname.includes(":") ? `[${hostname}]` : hostname;
        sendJson(response, 200, {
          streamKey,
          rtmpServerUrl: `rtmp://${bracketedHost}`,
          rtmpUrl: `rtmp://${bracketedHost}/${streamKey}`,
          webrtcUrl: `http://${bracketedHost}:8889/${streamKey}`,
          telemetryUrl: `http://${bracketedHost}:3000/api/telemetry?stream=${streamKey}`,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/broll") {
        const clips = (await readdir(brollDirectory, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && /\.(mp4|webm)$/i.test(entry.name))
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b));
        sendJson(response, 200, { clips });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/telemetry/latest") {
        const streamKey = streamKeyFrom(url);
        if (!streamKey) {
          sendJson(response, 400, { error: "invalid stream key" });
          return;
        }
        sendJson(response, 200, {
          telemetry: latestTelemetry.get(streamKey) ?? null,
          simulator: { running: simulators.get(streamKey)?.running ?? false },
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/events") {
        const streamKey = streamKeyFrom(url);
        if (!streamKey) {
          sendJson(response, 400, { error: "invalid stream key" });
          return;
        }
        applySecurityHeaders(response);
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        response.write("event: connected\ndata: {}\n\n");
        const currentTelemetry = latestTelemetry.get(streamKey);
        if (currentTelemetry) {
          response.write(
            `event: telemetry\ndata: ${JSON.stringify(currentTelemetry)}\n\n`,
          );
        }
        sseClients.set(response, streamKey);
        request.on("close", () => sseClients.delete(response));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/telemetry") {
        const streamKey = streamKeyFrom(url);
        if (!streamKey) {
          sendJson(response, 400, { error: "invalid stream key" });
          return;
        }
        if (!isSameOriginOrNonBrowser(request)) {
          sendJson(response, 403, { error: "cross-origin telemetry is not allowed" });
          return;
        }
        if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") {
          sendJson(response, 415, { error: "content-type must be application/json" });
          return;
        }
        if (!hasValidToken(request, telemetryToken)) {
          sendJson(response, 401, { error: "invalid telemetry token" });
          return;
        }
        if (!allowTelemetryRequest(request)) {
          sendJson(response, 429, { error: "telemetry rate limit exceeded" });
          return;
        }
        const telemetry = normalizeTelemetry(await readJsonBody(request));
        if (telemetry.source !== "simulator") simulators.get(streamKey)?.stop();
        publish(telemetry, streamKey);
        sendJson(response, 202, { accepted: true, telemetry });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/simulator/start") {
        const streamKey = streamKeyFrom(url);
        if (!streamKey) { sendJson(response, 400, { error: "invalid stream key" }); return; }
        if (!isSameOriginOrNonBrowser(request) || !allowSimulatorRequest(request)) {
          sendJson(response, 429, { error: "simulator request rejected" });
          return;
        }
        simulatorFor(streamKey).start();
        sendJson(response, 202, { simulator: { running: true } });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/simulator/stop") {
        const streamKey = streamKeyFrom(url);
        if (!streamKey) { sendJson(response, 400, { error: "invalid stream key" }); return; }
        if (!isSameOriginOrNonBrowser(request) || !allowSimulatorRequest(request)) {
          sendJson(response, 429, { error: "simulator request rejected" });
          return;
        }
        simulators.get(streamKey)?.stop();
        sendJson(response, 200, { simulator: { running: false } });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/stream/status") {
        const streamKey = streamKeyFrom(url);
        if (!streamKey) {
          sendJson(response, 400, { error: "invalid stream key" });
          return;
        }
        if (!mediaMtxApiUrl) {
          sendJson(response, 200, { live: false, reason: "media-server-disabled" });
          return;
        }

        try {
          const mediaResponse = await fetch(`${mediaMtxApiUrl}/v3/paths/get/${streamKey}`, {
            signal: AbortSignal.timeout(1000),
          });
          if (!mediaResponse.ok) {
            sendJson(response, 200, { live: false, reason: "stream-not-published" });
            return;
          }
          const mediaPath = await mediaResponse.json();
          sendJson(response, 200, {
            live: mediaPath.ready === true,
            bytesReceived: mediaPath.bytesReceived ?? null,
          });
        } catch {
          sendJson(response, 200, { live: false, reason: "media-server-unavailable" });
        }
        return;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        let pathname;
        try { pathname = decodeURIComponent(url.pathname); }
        catch { sendJson(response, 400, { error: "invalid path encoding" }); return; }
        await serveStatic(pathname, request, response);
        return;
      }

      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof TelemetryValidationError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      console.error(error);
      if (!response.headersSent) sendJson(response, 500, { error: "internal error" });
      else response.end();
    }
  });

  server.on("close", () => {
    for (const simulator of simulators.values()) simulator.stop();
    for (const client of sseClients.keys()) client.end();
    sseClients.clear();
  });

  return server;
}

const isMainModule =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const server = createDashboardServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`DJI dashboard listening on http://0.0.0.0:${port}`);
  });
}
