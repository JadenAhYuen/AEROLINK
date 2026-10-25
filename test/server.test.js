import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createDashboardServer } from "../src/server.js";

async function withServer(run, options = { mediaMtxApiUrl: null }) {
  const app = createDashboardServer(options);
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const { port } = app.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      app.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function withMockMediaMtx(responseBody, run) {
  const mediaServer = http.createServer((request, response) => {
    if (request.url === "/v3/paths/get/x") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(responseBody));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => mediaServer.listen(0, "127.0.0.1", resolve));
  const { port } = mediaServer.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      mediaServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("health endpoint reports ready", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  });
});

test("weather endpoint validates coordinates and fails closed when provider fails", async () => {
  await withServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/weather?latitude=91&longitude=0`);
    assert.equal(invalid.status, 400);
    const missing = await fetch(`${baseUrl}/api/weather?latitude=&longitude=0`);
    assert.equal(missing.status, 400);
    const failed = await fetch(`${baseUrl}/api/weather?latitude=52.52&longitude=13.41`);
    assert.equal(failed.status, 503);
    assert.match((await failed.json()).error, /No flight assessment/);
  }, { mediaMtxApiUrl: null, weatherOptions: { fetchWeather: async () => { throw new Error("offline"); } } });
});

test("place search returns selected coordinates without requiring typed GPS values", async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/places?q=x`)).status, 400);
    const response = await fetch(`${baseUrl}/api/places?q=Berlin`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { places: [{ name: "Berlin", region: "Berlin", country: "Germany", latitude: 52.52, longitude: 13.41 }] });
  }, { mediaMtxApiUrl: null, searchPlaces: async () => [{ name: "Berlin", region: "Berlin", country: "Germany", latitude: 52.52, longitude: 13.41 }] });
});

test("config uses the request hostname for short RTMP and WebRTC URLs", async () => {
  await withServer(async (baseUrl) => {
    const target = new URL(baseUrl);
    const config = await new Promise((resolve, reject) => {
      const request = http.get({
        hostname: target.hostname,
        port: target.port,
        path: "/api/config?stream=drone-7k2p9q",
        headers: { host: "192.168.1.44:3000" },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on("error", reject);
    });

    assert.equal(config.streamKey, "drone-7k2p9q");
    assert.equal(config.rtmpServerUrl, "rtmp://192.168.1.44");
    assert.equal(config.rtmpUrl, "rtmp://192.168.1.44/drone-7k2p9q");
    assert.equal(config.webrtcUrl, "http://192.168.1.44:8889/drone-7k2p9q");
  });
});

test("static assets support byte ranges and HEAD without transferring entire files", async () => {
  await withServer(async (baseUrl) => {
    const full = await fetch(`${baseUrl}/index.html`);
    const content = await full.text();
    const partial = await fetch(`${baseUrl}/index.html`, { headers: { range: "bytes=0-14" } });
    assert.equal(partial.status, 206);
    assert.equal(await partial.text(), content.slice(0, 15));
    assert.match(partial.headers.get("content-range"), /^bytes 0-14\//);
    const invalid = await fetch(`${baseUrl}/index.html`, { headers: { range: "bytes=9999999-" } });
    assert.equal(invalid.status, 416);
    const head = await fetch(`${baseUrl}/index.html`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(Buffer.byteLength(content)));
    assert.equal(await head.text(), "");
  });
});

test("demo and receiver data are isolated per stream", async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/api/simulator/start?stream=drone-a`, { method: "POST" });
    await fetch(`${baseUrl}/api/simulator/start?stream=drone-b`, { method: "POST" });
    const a = await (await fetch(`${baseUrl}/api/telemetry/latest?stream=drone-a`)).json();
    assert.equal(a.simulator.running, true);
    assert.equal(a.telemetry.source, "simulator");
    const defaultFeed = await (await fetch(`${baseUrl}/api/telemetry/latest`)).json();
    assert.equal(defaultFeed.telemetry, null);
    assert.equal(defaultFeed.simulator.running, false);
    const receiver = await fetch(`${baseUrl}/api/telemetry?stream=drone-a`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "remote-id", uasId: "RECEIVER-A", latitude: 0, longitude: 0 }),
    });
    assert.equal(receiver.status, 202);
    const afterA = await (await fetch(`${baseUrl}/api/telemetry/latest?stream=drone-a`)).json();
    const afterB = await (await fetch(`${baseUrl}/api/telemetry/latest?stream=drone-b`)).json();
    assert.equal(afterA.simulator.running, false);
    assert.equal(afterA.telemetry.uasId, "RECEIVER-A");
    assert.equal(afterB.simulator.running, true);
    assert.equal(afterB.telemetry.source, "simulator");
  });
});

test("telemetry endpoint validates, stores, and returns an observation", async () => {
  await withServer(async (baseUrl) => {
    const accepted = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latitude: -20.16, longitude: 57.5 }),
    });
    assert.equal(accepted.status, 202);

    const latest = await fetch(`${baseUrl}/api/telemetry/latest`);
    assert.equal(latest.status, 200);
    const body = await latest.json();
    assert.equal(body.telemetry.latitude, -20.16);
  });
});

test("telemetry endpoint rejects malformed observations", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latitude: 500, longitude: 57.5 }),
    });
    assert.equal(response.status, 400);
  });
});

test("telemetry endpoint rejects malformed and oversized JSON", async () => {
  await withServer(async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    assert.equal(malformed.status, 400);
    assert.match((await malformed.json()).error, /valid JSON/);

    const oversized = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(17 * 1024) }),
    });
    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error, /16 KiB/);
  });
});

test("telemetry endpoint requires JSON and rejects cross-origin browser posts", async () => {
  await withServer(async (baseUrl) => {
    const wrongType = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      body: JSON.stringify({ latitude: -20.16, longitude: 57.5 }),
    });
    assert.equal(wrongType.status, 415);

    const crossOrigin = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ latitude: -20.16, longitude: 57.5 }),
    });
    assert.equal(crossOrigin.status, 403);
  });
});

test("telemetry endpoint supports an optional receiver token", async () => {
  await withServer(async (baseUrl) => {
    const rejected = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latitude: -20.16, longitude: 57.5 }),
    });
    assert.equal(rejected.status, 401);

    const accepted = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer receiver-test-token",
      },
      body: JSON.stringify({ latitude: -20.16, longitude: 57.5 }),
    });
    assert.equal(accepted.status, 202);
  }, { mediaMtxApiUrl: null, telemetryToken: "receiver-test-token" });
});

test("SSE clients receive newly accepted telemetry", async () => {
  await withServer(async (baseUrl) => {
    const controller = new AbortController();
    const eventsResponse = await fetch(`${baseUrl}/api/events`, {
      signal: controller.signal,
    });
    const reader = eventsResponse.body.getReader();

    await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latitude: -20.16, longitude: 57.5, uasId: "SSE-TEST" }),
    });

    let received = "";
    while (!received.includes("SSE-TEST")) {
      const { value, done } = await reader.read();
      if (done) break;
      received += new TextDecoder().decode(value);
    }
    assert.match(received, /event: telemetry/);
    assert.match(received, /SSE-TEST/);
    await reader.cancel();
    controller.abort();
  });
});

test("static dashboard is served and unknown files return 404", async () => {
  await withServer(async (baseUrl) => {
    const dashboard = await fetch(baseUrl);
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /AEROLINK Flight Viewer/);
    const clean = await fetch(`${baseUrl}/output?stream=x`);
    assert.equal(clean.status, 200);
    assert.match(await clean.text(), /AEROLINK Flight Viewer/);

    const missing = await fetch(`${baseUrl}/does-not-exist.css`);
    assert.equal(missing.status, 404);
  });
});

test("stream status reflects MediaMTX path readiness", async () => {
  await withMockMediaMtx({ ready: true, bytesReceived: 4096 }, async (mediaMtxApiUrl) => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/stream/status`);
      assert.deepEqual(await response.json(), { live: true, bytesReceived: 4096 });
    }, { mediaMtxApiUrl });
  });
});

test("stream status degrades safely when MediaMTX is unavailable", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/stream/status`);
    assert.deepEqual(await response.json(), {
      live: false,
      reason: "media-server-unavailable",
    });
  }, { mediaMtxApiUrl: "http://127.0.0.1:1" });
});

test("simulator can be started and stopped", async () => {
  await withServer(async (baseUrl) => {
    const start = await fetch(`${baseUrl}/api/simulator/start`, { method: "POST" });
    assert.equal(start.status, 202);
    assert.equal((await start.json()).simulator.running, true);

    const stop = await fetch(`${baseUrl}/api/simulator/stop`, { method: "POST" });
    assert.equal(stop.status, 200);
    assert.equal((await stop.json()).simulator.running, false);
  });
});

test("real receiver telemetry automatically stops the simulator", async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/api/simulator/start`, { method: "POST" });
    const accepted = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "remote-id",
        latitude: -20.16,
        longitude: 57.5,
      }),
    });
    assert.equal(accepted.status, 202);

    const latest = await fetch(`${baseUrl}/api/telemetry/latest`);
    const body = await latest.json();
    assert.equal(body.simulator.running, false);
    assert.equal(body.telemetry.source, "remote-id");
  });
});
