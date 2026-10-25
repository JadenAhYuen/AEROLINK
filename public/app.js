import {
  DEFAULT_PREFERENCES,
  convertTelemetry,
  loadPreferences,
  normalizePreferences,
  resolveIdentity,
  savePreferences,
} from "./preferences.js";
import { DRONE_PROFILES, droneProfile } from "./drone-profiles.js";
import { assessWeather, weatherDescription, WEATHER_DISCLAIMER } from "./weather.js";

const elementIds = [
  "video-status", "telemetry-status", "video-frame", "video-placeholder", "live-badge",
  "rtmp-url", "copy-url", "reload-video", "freshness", "freshness-label", "source-badge",
  "height-value", "height-unit", "speed-value", "speed-unit", "distance-value", "distance-unit",
  "course-value", "course-arrow", "bearing-value", "signal-value", "uas-id", "operator-id",
  "position-value", "demo-button", "demo-label", "telemetry-endpoint", "track-line",
  "aircraft-marker", "track-empty", "scale-label", "toast", "aircraft-name", "settings-button",
  "settings-dialog", "settings-form", "settings-close", "settings-saved", "reset-settings", "reset-overlay-layout", "edit-identity",
  "track-panel", "identity-section", "signal-metric", "uas-override-badge", "operator-override-badge",
  "settings-rtmp-url", "settings-copy-url", "settings-stream-key", "settings-new-key", "settings-switch-feed", "settings-viewer-url", "telemetry-panel",
  "placeholder-reel-a", "placeholder-reel-b", "welcome-screen", "skip-welcome", "clean-output-note", "clean-output-url", "clean-output-copy", "clean-output-open", "settings-full-rtmp-url",
  "drone-model", "weather-model-note", "weather-panel", "weather-status", "weather-model", "weather-condition", "weather-wind", "weather-gust", "weather-icon", "weather-age", "wind-meter", "wind-marker", "weather-disclaimer", "weather-check", "weather-use-location", "weather-settings-result", "weather-place-query", "weather-place-search", "weather-place-results",
];

const elements = Object.fromEntries(elementIds.map((id) => [id, document.getElementById(id)]));
const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const streamKeyPattern = /^[a-z0-9][a-z0-9-]{0,15}$/;

function currentStreamKey() {
  const key = new URLSearchParams(window.location.search).get("stream")?.toLowerCase() ?? "x";
  return streamKeyPattern.test(key) ? key : "x";
}

function streamApi(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("stream", currentStreamKey());
  return `${url.pathname}${url.search}`;
}

function randomStreamKey() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return `drone-${bytes[0].toString(36).slice(0, 6)}`;
}

const preferencesStorageKey = `aerolink-preferences:${currentStreamKey()}`;
const pendingStreamKeyStorageKey = `aerolink-pending-stream:${currentStreamKey()}`;
let preferenceStorage;
try {
  preferenceStorage = window.localStorage;
  if (currentStreamKey() === "x" && !preferenceStorage.getItem(preferencesStorageKey)) {
    savePreferences(preferenceStorage, loadPreferences(preferenceStorage), preferencesStorageKey);
  }
} catch { }
const state = {
  config: null,
  telemetry: null,
  trail: [],
  simulatorRunning: false,
  videoLive: false,
  toastTimer: null,
  preferences: loadPreferences(preferenceStorage, preferencesStorageKey),
  savedPreferences: loadPreferences(preferenceStorage, preferencesStorageKey),
  weatherData: null,
  weatherKey: null,
  weatherError: null,
  weatherRequest: 0,
};

const overlayPanels = {
  weather: elements["weather-panel"], telemetry: elements["telemetry-panel"], track: elements["track-panel"],
};
const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

function panelBounds(name, entry = null) {
  const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
  const compact = viewportWidth <= 700;
  const margin = compact ? 8 : 22;
  const top = compact ? 76 : 94;
  const minimumHeight = name === "track" ? 150 : 120;
  const defaultWidth = compact ? name === "track" ? 240 : 280 : name === "weather" ? 300 : name === "telemetry" ? 350 : 340;
  const width = clamp(entry?.width ?? defaultWidth, Math.min(220, viewportWidth - 16), viewportWidth - 16);
  const trackY = viewportHeight - (compact ? 175 : 275);
  const initialY = name === "weather" ? top : name === "telemetry" ? top + (state.preferences.weather.enabled ? 202 : 0) : trackY;
  const compactTelemetryHeight = state.preferences.panels.track ? clamp(trackY - initialY - 12, 120, 250) : 250;
  const defaultHeight = name === "weather" ? 190 : name === "telemetry" ? compact ? compactTelemetryHeight : 480 : compact ? 165 : 255;
  const y = clamp(entry?.y ?? initialY, 8, Math.max(8, viewportHeight - minimumHeight - 8));
  const height = clamp(entry?.height ?? defaultHeight, minimumHeight, Math.max(minimumHeight, viewportHeight - y - 8));
  const x = clamp(entry?.x ?? (name === "track" ? margin : viewportWidth - width - margin), 8, viewportWidth - width - 8);
  return { x, y, width, height };
}

function setPanelBounds(panel, bounds) {
  panel.style.setProperty("--overlay-x", `${bounds.x}px`);
  panel.style.setProperty("--overlay-y", `${bounds.y}px`);
  panel.style.setProperty("--overlay-width", `${bounds.width}px`);
  panel.style.setProperty("--overlay-height", `${bounds.height}px`);
}

function applyOverlayLayout() {
  for (const [name, panel] of Object.entries(overlayPanels)) {
    setPanelBounds(panel, panelBounds(name, state.preferences.overlayLayout[name]));
  }
}

function storeOverlayBounds(name) {
  const rect = overlayPanels[name].getBoundingClientRect();
  const entry = panelBounds(name, { x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  try {
    state.savedPreferences = savePreferences(preferenceStorage, {
      ...state.savedPreferences,
      overlayLayout: { ...state.savedPreferences.overlayLayout, [name]: entry },
    }, preferencesStorageKey);
    state.preferences = state.savedPreferences;
  } catch { showToast("Overlay position could not be saved"); }
  applyOverlayLayout();
}

for (const [name, panel] of Object.entries(overlayPanels)) {
  for (const kind of ["handle", "resize"]) {
    const control = panel.querySelector(`[data-overlay-${kind}="${name}"]`);
    control.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const start = panel.getBoundingClientRect();
      const originX = event.clientX, originY = event.clientY;
      panel.style.zIndex = "25";
      control.setPointerCapture(event.pointerId);
      const move = (next) => {
        const dx = next.clientX - originX, dy = next.clientY - originY;
        const proposed = kind === "handle"
          ? { x: start.left + dx, y: start.top + dy, width: start.width, height: start.height }
          : { x: start.left, y: start.top, width: start.width + dx, height: start.height + dy };
        setPanelBounds(panel, panelBounds(name, proposed));
      };
      const finish = () => {
        control.removeEventListener("pointermove", move);
        control.removeEventListener("pointerup", finish);
        control.removeEventListener("pointercancel", finish);
        panel.style.zIndex = "";
        storeOverlayBounds(name);
      };
      control.addEventListener("pointermove", move);
      control.addEventListener("pointerup", finish);
      control.addEventListener("pointercancel", finish);
    });
    control.addEventListener("keydown", (event) => {
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta) return;
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      const step = event.shiftKey ? 32 : 8;
      const proposed = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      if (kind === "handle") { proposed.x += delta[0] * step; proposed.y += delta[1] * step; }
      else { proposed.width += delta[0] * step; proposed.height += delta[1] * step; }
      setPanelBounds(panel, panelBounds(name, proposed));
      storeOverlayBounds(name);
    });
  }
}
window.addEventListener("resize", applyOverlayLayout);

for (const profile of DRONE_PROFILES) elements["drone-model"].add(new Option(profile.name, profile.id));
elements["weather-disclaimer"].textContent = WEATHER_DISCLAIMER;

function weatherLocationKey(preferences) {
  const { latitude, longitude } = preferences.weather;
  return latitude === null || longitude === null ? null : `${latitude},${longitude}`;
}

function windDisplay(value) {
  if (!Number.isFinite(value)) return "—";
  return state.preferences.units === "aviation" ? `${(value * 1.94384).toFixed(1)} kt` : `${value.toFixed(1)} m/s`;
}

function weatherIcon(code) {
  if (code >= 95) return "⚡";
  if (code >= 51) return "☂";
  if (code === 45 || code === 48) return "≋";
  if (code === 0 || code === 1) return "☼";
  if (code >= 2) return "☁";
  return "◌";
}

function renderWeather() {
  const panel = elements["weather-panel"];
  const prefs = state.preferences;
  panel.classList.toggle("preference-hidden", !prefs.weather.enabled);
  const profile = droneProfile(prefs.droneModel);
  elements["weather-model"].textContent = profile.name;
  const key = weatherLocationKey(prefs);
  const data = key === state.weatherKey ? state.weatherData : null;
  const assessment = data ? assessWeather(data, profile.id, prefs.weather.pilotLimitMps) : null;
  const level = assessment?.level ?? "unknown";
  panel.dataset.level = level;
  elements["weather-status"].textContent = { favourable: "LOW RISK*", caution: "CAUTION", "no-go": "DO NOT FLY", unknown: key ? state.weatherError || "NO DATA" : "SET LOCATION" }[level];
  elements["weather-condition"].textContent = data ? weatherDescription(data.weatherCode) : key ? "Weather unavailable" : "Set location";
  elements["weather-icon"].textContent = data ? weatherIcon(data.weatherCode) : "◌";
  elements["weather-wind"].textContent = windDisplay(data?.windMps);
  elements["weather-gust"].textContent = windDisplay(data?.gustMps);
  const limit = assessment?.limitMps ?? profile.maxWindMps;
  const ratio = data && Number.isFinite(limit) && limit > 0 ? Math.min(100, Math.max(0, Math.max(data.windMps, data.gustMps) / limit * 100)) : null;
  elements["wind-meter"].classList.toggle("empty", ratio === null || level === "unknown");
  elements["wind-meter"].setAttribute("aria-valuenow", ratio === null || level === "unknown" ? "0" : String(Math.round(ratio)));
  elements["wind-meter"].setAttribute("aria-valuetext", ratio === null || level === "unknown" ? "No current wind assessment" : `Peak wind ${Math.round(ratio)}% of ${windDisplay(limit)} limit`);
  elements["wind-marker"].style.left = `${ratio ?? 0}%`;
  elements["weather-age"].textContent = data ? `Updated ${Math.max(0, Math.floor((Date.now() - Date.parse(data.fetchedAt)) / 60_000))}m ago` : "Check Settings";
}

async function refreshWeather({ force = false, coordinates = null } = {}) {
  const prefs = state.preferences;
  if (cleanOutputEnabled() || (!prefs.weather.enabled && !force)) return;
  const location = coordinates || prefs.weather;
  const key = location.latitude === null || location.longitude === null ? null : `${location.latitude},${location.longitude}`;
  if (!key) { state.weatherData = null; state.weatherKey = null; renderWeather(); return; }
  if (!force && state.weatherKey === key && state.weatherData && Date.now() - new Date(state.weatherData.fetchedAt).getTime() < 5 * 60_000) { renderWeather(); return; }
  const request = ++state.weatherRequest;
  state.weatherError = null;
  if (state.weatherKey !== key) { state.weatherData = null; state.weatherKey = null; }
  renderWeather();
  try {
    const url = new URL("/api/weather", window.location.origin);
    url.searchParams.set("latitude", String(location.latitude));
    url.searchParams.set("longitude", String(location.longitude));
    const response = await fetch(url);
    if (!response.ok) throw new Error("Weather unavailable");
    const data = await response.json();
    if (request !== state.weatherRequest) return;
    state.weatherKey = key;
    state.weatherData = data;
    state.weatherError = null;
  } catch {
    if (request !== state.weatherRequest) return;
    state.weatherData = null;
    state.weatherKey = null;
    state.weatherError = "UNAVAILABLE";
  }
  renderWeather();
}

function cleanOutputEnabled() {
  return new URLSearchParams(window.location.search).get("output") === "clean";
}

function setVideoSource(video, source) {
  video.src = source;
  video.load();
}

async function initializeBroll() {
  try {
    const response = await fetch("/api/broll", { cache: "no-store" });
    const playlist = await response.json();
    const clips = Array.isArray(playlist.clips) ? playlist.clips.filter((clip) => typeof clip === "string") : [];
    if (!clips.length) return;
    let active = elements["placeholder-reel-a"];
    let waiting = elements["placeholder-reel-b"];
    const fadeDurationMs = 1600;
    let currentIndex = 0;
    let transitioning = false;

    const clipUrl = (index) => `/assets/broll/${encodeURIComponent(clips[index])}`;
    const loadClip = (video, index) => {
      video.dataset.clipIndex = String(index);
      setVideoSource(video, clipUrl(index));
    };
    const cueNext = () => {
      const nextIndex = (currentIndex + 1) % clips.length;
      if (waiting.dataset.clipIndex !== String(nextIndex)) loadClip(waiting, nextIndex);
    };
    const beginTransition = async () => {
      if (transitioning) return;
      if (waiting.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
      transitioning = true;
      const incoming = waiting;
      const outgoing = active;
      try {
        incoming.currentTime = 0;
        await incoming.play();
        // Fade decoded frames over the outgoing picture to avoid a dark midpoint.
        incoming.style.zIndex = "2";
        outgoing.style.zIndex = "1";
        if (incoming.requestVideoFrameCallback) {
          await Promise.race([
            new Promise((resolve) => incoming.requestVideoFrameCallback(resolve)),
            new Promise((resolve) => setTimeout(resolve, 500)),
          ]);
        }
        incoming.classList.add("active");
        await new Promise((resolve) => setTimeout(resolve, fadeDurationMs + 80));
        outgoing.classList.remove("active");
        outgoing.pause();
        outgoing.style.zIndex = "0";
        [active, waiting] = [incoming, outgoing];
        currentIndex = Number(active.dataset.clipIndex);
        cueNext();
      } catch {
        // Keep the last decoded picture visible if a clip cannot play.
      } finally { transitioning = false; }
    };

    for (const video of [active, waiting]) {
      video.addEventListener("timeupdate", () => {
        if (video === active && video.duration - video.currentTime <= fadeDurationMs / 1000) beginTransition();
      });
      video.addEventListener("canplay", () => {
        if (active.ended) beginTransition();
      });
      video.addEventListener("ended", () => {
        if (video === active) beginTransition();
      });
    }
    loadClip(active, currentIndex);
    cueNext();
    active.play().catch(() => {});
  } catch {
    // A missing custom reel never prevents the live viewer from working.
  }
}

function dismissWelcome() {
  elements["welcome-screen"]?.classList.add("hidden");
}

function formatNumber(value, digits = null) {
  if (!Number.isFinite(value)) return "-";
  return digits === null ? String(value) : value.toFixed(digits);
}

function distanceAndBearing(fromLat, fromLon, toLat, toLon) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const degrees = (value) => (value * 180) / Math.PI;
  const radius = 6_371_000;
  const phi1 = radians(fromLat);
  const phi2 = radians(toLat);
  const deltaPhi = radians(toLat - fromLat);
  const deltaLambda = radians(toLon - fromLon);
  const a = Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const distanceM = radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return { distanceM, bearingDeg: (degrees(Math.atan2(y, x)) + 360) % 360 };
}

function localMeters(latitude, longitude, homeLatitude, homeLongitude) {
  const metersPerLatitudeDegree = 111_320;
  const metersPerLongitudeDegree = 111_320 * Math.cos((homeLatitude * Math.PI) / 180);
  return {
    x: (longitude - homeLongitude) * metersPerLongitudeDegree,
    y: (latitude - homeLatitude) * metersPerLatitudeDegree,
  };
}

function setStatus(element, stateName, label) {
  element.dataset.state = stateName;
  element.lastElementChild.textContent = label;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2200);
}

function effectiveDarkMode(theme = state.preferences.theme) {
  return theme === "dark" || (theme === "system" && colorSchemeQuery.matches);
}

function updateBrowserChrome(theme = state.preferences.theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = effectiveDarkMode(theme) ? "#080d15" : "#edf3f9";
}

function renderIdentity() {
  const identity = resolveIdentity(state.telemetry ?? {}, state.preferences);
  elements["uas-id"].textContent = identity.uasId;
  elements["operator-id"].textContent = identity.operatorId;
  elements["uas-override-badge"].classList.toggle("visible", identity.uasOverridden);
  elements["operator-override-badge"].classList.toggle("visible", identity.operatorOverridden);
}

function applyPreferences(preferences, { renderData = true } = {}) {
  const normalized = normalizePreferences(preferences);
  document.documentElement.dataset.theme = normalized.theme;
  document.documentElement.dataset.accent = normalized.accent;
  elements["aircraft-name"].textContent = normalized.aircraftName;
  document.title = `AEROLINK — ${normalized.aircraftName}`;
  elements["track-panel"].classList.toggle("preference-hidden", !normalized.panels.track);
  elements["telemetry-panel"]?.classList.toggle("preference-hidden", !normalized.panels.overlay);
  state.preferences = normalized;
  renderWeather();
  applyOverlayLayout();
  elements["identity-section"].classList.toggle("preference-hidden", !normalized.panels.identity);
  elements["signal-metric"].classList.toggle("preference-hidden", !normalized.panels.signal);
  document.documentElement.classList.toggle("clean-output", cleanOutputEnabled());
  updateBrowserChrome(normalized.theme);

  if (renderData) {
    renderIdentity();
    renderTelemetryValues();
    updateTrack();
  }
}

function getHomeVector(telemetry) {
  if (!telemetry || !Number.isFinite(telemetry.homeLatitude) || !Number.isFinite(telemetry.homeLongitude)) {
    return null;
  }
  return {
    fromHome: distanceAndBearing(
      telemetry.homeLatitude,
      telemetry.homeLongitude,
      telemetry.latitude,
      telemetry.longitude,
    ),
    toHome: distanceAndBearing(
      telemetry.latitude,
      telemetry.longitude,
      telemetry.homeLatitude,
      telemetry.homeLongitude,
    ),
  };
}

function renderTelemetryValues() {
  const telemetry = state.telemetry;
  const homeVector = getHomeVector(telemetry);
  const display = convertTelemetry({
    heightM: telemetry?.heightM,
    groundSpeedMps: telemetry?.groundSpeedMps,
    distanceM: homeVector?.fromHome.distanceM,
  }, state.preferences.units);

  elements["height-value"].textContent = formatNumber(display.height.value);
  elements["height-unit"].textContent = display.height.unit;
  elements["speed-value"].textContent = formatNumber(display.speed.value);
  elements["speed-unit"].textContent = display.speed.unit;
  elements["distance-value"].textContent = formatNumber(display.distance.value);
  elements["distance-unit"].textContent = display.distance.unit;

  if (!telemetry) {
    elements["course-value"].textContent = "-";
    elements["bearing-value"].textContent = "-";
    elements["signal-value"].textContent = "-";
    elements["position-value"].textContent = "-";
    renderIdentity();
    return;
  }

  elements["course-value"].textContent = formatNumber(telemetry.courseDeg, 0);
  elements["course-arrow"].style.transform = `rotate(${telemetry.courseDeg ?? 0}deg)`;
  elements["bearing-value"].textContent = homeVector ? formatNumber(homeVector.toHome.bearingDeg, 0) : "-";
  elements["signal-value"].textContent = formatNumber(telemetry.rssiDbm, 0);
  elements["position-value"].textContent = `${telemetry.latitude.toFixed(6)}, ${telemetry.longitude.toFixed(6)}`;
  renderIdentity();
}

function updateTrack() {
  const telemetry = state.telemetry;
  if (!telemetry || !Number.isFinite(telemetry.homeLatitude) || !Number.isFinite(telemetry.homeLongitude)) {
    elements["track-empty"].classList.remove("hidden");
    elements["scale-label"].textContent = "Range: waiting for position";
    return;
  }
  elements["track-empty"].classList.add("hidden");

  const points = state.trail
    .filter((point) => Number.isFinite(point.homeLatitude) && Number.isFinite(point.homeLongitude))
    .map((point) => ({
      ...localMeters(point.latitude, point.longitude, telemetry.homeLatitude, telemetry.homeLongitude),
      courseDeg: point.courseDeg,
    }));
  if (!points.length) return;

  const maxDistance = Math.max(25, ...points.map((point) => Math.hypot(point.x, point.y)));
  const range = Math.ceil(maxDistance / 25) * 25;
  const scale = 150 / range;
  const svgPoints = points.map((point) => `${350 + point.x * scale},${165 - point.y * scale}`).join(" ");
  elements["track-line"].setAttribute("points", svgPoints);

  const latest = points.at(-1);
  const course = Number.isFinite(latest.courseDeg) ? latest.courseDeg : 0;
  elements["aircraft-marker"].setAttribute(
    "transform",
    `translate(${350 + latest.x * scale} ${165 - latest.y * scale}) rotate(${course})`,
  );
  const converted = convertTelemetry({ distanceM: range }, state.preferences.units).distance;
  elements["scale-label"].textContent = `Outer range: ${converted.value} ${converted.unit}`;
}

function updateFreshness() {
  if (!state.telemetry) {
    setStatus(elements["telemetry-status"], "idle", "Telemetry · In development");
    elements["freshness-label"].textContent = "Waiting for receiver";
    elements.freshness.classList.remove("stale");
    return;
  }

  const ageSeconds = Math.max(0, (Date.now() - Date.parse(state.telemetry.receivedAt)) / 1000);
  const stale = ageSeconds > 5;
  setStatus(
    elements["telemetry-status"],
    stale ? "stale" : "live",
    state.telemetry.source === "simulator" ? (stale ? "Demo stopped" : "Demo · Simulated") : (stale ? `Receiver stale - ${Math.floor(ageSeconds)}s` : "Receiver data"),
  );
  elements.freshness.classList.toggle("stale", stale);
  elements["freshness-label"].textContent = stale
    ? `Last packet ${Math.floor(ageSeconds)} seconds ago`
    : `Updated ${ageSeconds < 1 ? "now" : `${Math.floor(ageSeconds)}s ago`}`;
  elements.freshness.querySelector(".freshness-line span").style.transform = `scaleX(${Math.max(0, 1 - ageSeconds / 5)})`;
}

function updateTelemetry(telemetry) {
  const previous = state.telemetry;
  const sourceChanged = previous && previous.source !== telemetry.source;
  const aircraftChanged = previous?.uasId && telemetry.uasId && previous.uasId !== telemetry.uasId;
  const homeChanged = previous &&
    Number.isFinite(previous.homeLatitude) &&
    Number.isFinite(previous.homeLongitude) &&
    Number.isFinite(telemetry.homeLatitude) &&
    Number.isFinite(telemetry.homeLongitude) &&
    (Math.abs(previous.homeLatitude - telemetry.homeLatitude) > 0.001 ||
      Math.abs(previous.homeLongitude - telemetry.homeLongitude) > 0.001);
  if (sourceChanged || aircraftChanged || homeChanged) state.trail = [];

  state.telemetry = telemetry;
  state.trail.push(telemetry);
  if (state.trail.length > 180) state.trail.shift();

  const simulated = telemetry.source === "simulator";
  elements["source-badge"].textContent = simulated ? "SIMULATED" : "RECEIVER DATA";
  elements["source-badge"].className = `source-badge ${simulated ? "demo" : "real"}`;
  renderTelemetryValues();
  updateFreshness();
  updateTrack();
}

async function refreshStreamStatus() {
  try {
    const response = await fetch(streamApi("/api/stream/status"), { cache: "no-store" });
    const status = await response.json();
    const wasLive = state.videoLive;
    state.videoLive = status.live === true;
    document.body.classList.toggle("video-live", state.videoLive);
    setStatus(elements["video-status"], state.videoLive ? "live" : "idle", state.videoLive ? "Video live" : "Video waiting");
    elements["video-placeholder"].classList.toggle("hidden", state.videoLive);
    elements["live-badge"].classList.toggle("visible", state.videoLive);
    if (state.videoLive && !wasLive) reloadVideo();
  } catch {
    state.videoLive = false;
    document.body.classList.remove("video-live");
    elements["video-placeholder"].classList.remove("hidden");
    elements["live-badge"].classList.remove("visible");
    setStatus(elements["video-status"], "idle", "Gateway offline");
  }
}

function reloadVideo() {
  if (!state.config) return;
  const url = new URL(state.config.webrtcUrl);
  url.searchParams.set("autoplay", "true");
  url.searchParams.set("muted", "true");
  url.searchParams.set("controls", cleanOutputEnabled() ? "false" : "true");
  url.searchParams.set("playsInline", "true");
  url.searchParams.set("reload", Date.now().toString());
  elements["video-frame"].src = url.toString();
}

function renderSimulatorState() {
  elements["demo-button"].classList.toggle("running", state.simulatorRunning);
  elements["demo-label"].textContent = state.simulatorRunning ? "Stop telemetry demo" : "Run telemetry demo";
  elements["demo-button"].querySelector(".play-icon").textContent = state.simulatorRunning ? "■" : "▶";
}

async function toggleSimulator() {
  const action = state.simulatorRunning ? "stop" : "start";
  const response = await fetch(streamApi(`/api/simulator/${action}`), { method: "POST" });
  if (!response.ok) throw new Error("Simulator unavailable");
  const body = await response.json();
  state.simulatorRunning = body.simulator.running;
  renderSimulatorState();
  showToast(state.simulatorRunning ? "Simulated flight started" : "Simulated flight stopped");
}

function fillSettings(preferences) {
  const normalized = normalizePreferences(preferences);
  const form = elements["settings-form"];
  form.elements.namedItem("theme").value = normalized.theme;
  form.elements.namedItem("accent").value = normalized.accent;
  form.elements.namedItem("units").value = normalized.units;
  form.elements.namedItem("aircraftName").value = normalized.aircraftName;
  form.elements.namedItem("uasId").value = normalized.uasId;
  form.elements.namedItem("operatorId").value = normalized.operatorId;
  form.elements.namedItem("droneModel").value = normalized.droneModel;
  form.elements.namedItem("weatherEnabled").checked = normalized.weather.enabled;
  form.elements.namedItem("weatherLatitude").value = normalized.weather.latitude ?? "";
  form.elements.namedItem("weatherLongitude").value = normalized.weather.longitude ?? "";
  form.elements.namedItem("pilotLimitMps").value = normalized.weather.pilotLimitMps ?? "";
  updateWeatherModelNote();
  form.elements.namedItem("panelTrack").checked = normalized.panels.track;
  form.elements.namedItem("panelOverlay").checked = normalized.panels.overlay;
  form.elements.namedItem("panelIdentity").checked = normalized.panels.identity;
  form.elements.namedItem("panelSignal").checked = normalized.panels.signal;
  form.elements.namedItem("rawOutput").checked = normalized.panels.rawOutput || cleanOutputEnabled();
  updateCleanOutputLink(form.elements.namedItem("rawOutput").checked);
  const pendingKey = preferenceStorage?.getItem(pendingStreamKeyStorageKey)?.toLowerCase();
  elements["settings-stream-key"].value = pendingKey && streamKeyPattern.test(pendingKey) ? pendingKey : currentStreamKey();
  const viewerUrl = new URL(window.location.href);
  viewerUrl.searchParams.set("stream", currentStreamKey());
  viewerUrl.searchParams.delete("output");
  elements["settings-viewer-url"].textContent = viewerUrl.toString();
  updateConnectionLinks();
}

function updateCleanOutputLink(enabled) {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.set("stream", settingsStreamKey());
  cleanUrl.searchParams.set("output", "clean");
  elements["clean-output-url"].textContent = cleanUrl.toString();
  elements["clean-output-open"].href = cleanUrl.toString();
  elements["clean-output-note"].hidden = !enabled;
}

function settingsStreamKey() {
  const key = elements["settings-stream-key"].value.trim().toLowerCase();
  return streamKeyPattern.test(key) ? key : currentStreamKey();
}

function updateConnectionLinks() {
  if (!state.config) return;
  const key = settingsStreamKey();
  const serverUrl = state.config.rtmpServerUrl ?? state.config.rtmpUrl.replace(/\/[^/]+$/, "");
  elements["settings-rtmp-url"].textContent = serverUrl;
  elements["settings-full-rtmp-url"].textContent = `${serverUrl}/${key}`;
  const viewerUrl = new URL(window.location.href);
  viewerUrl.searchParams.set("stream", key);
  viewerUrl.searchParams.delete("output");
  elements["settings-viewer-url"].textContent = viewerUrl.toString();
  updateCleanOutputLink(elements["settings-form"].elements.namedItem("rawOutput").checked);
}

function preferencesFromForm() {
  const form = elements["settings-form"];
  return normalizePreferences({
    theme: form.elements.namedItem("theme").value,
    accent: form.elements.namedItem("accent").value,
    units: form.elements.namedItem("units").value,
    aircraftName: form.elements.namedItem("aircraftName").value,
    uasId: form.elements.namedItem("uasId").value,
    operatorId: form.elements.namedItem("operatorId").value,
    droneModel: form.elements.namedItem("droneModel").value,
    overlayLayout: state.savedPreferences.overlayLayout,
    weather: {
      enabled: form.elements.namedItem("weatherEnabled").checked,
      latitude: form.elements.namedItem("weatherLatitude").value,
      longitude: form.elements.namedItem("weatherLongitude").value,
      pilotLimitMps: form.elements.namedItem("pilotLimitMps").value,
    },
    panels: {
      track: form.elements.namedItem("panelTrack").checked,
      overlay: form.elements.namedItem("panelOverlay").checked,
      identity: form.elements.namedItem("panelIdentity").checked,
      signal: form.elements.namedItem("panelSignal").checked,
      rawOutput: form.elements.namedItem("rawOutput").checked,
    },
  });
}

function openSettings(focusIdentity = false) {
  fillSettings(state.savedPreferences);
  elements["settings-saved"].textContent = "Changes save automatically";
  elements["settings-dialog"].showModal();
  if (focusIdentity) requestAnimationFrame(() => elements["settings-form"].elements.namedItem("uasId").focus());
}

function updateWeatherModelNote() {
  const profile = droneProfile(elements["drone-model"].value);
  elements["weather-model-note"].textContent = profile.id === "none"
    ? "Select your aircraft model to compare wind against its rating. Choose Other aircraft if it is not listed."
    : profile.maxWindMps === null
    ? "Enter a conservative pilot wind limit for this aircraft. Without a verified manufacturer rating, the result remains Caution at best."
    : `${profile.name}: DJI published maximum wind resistance ${profile.maxWindMps} m/s. A lower pilot limit takes precedence.`;
}

function closeSettings() {
  if (settingsSaveTimer) { clearTimeout(settingsSaveTimer); settingsSaveTimer = null; persistSettings(); }
  elements["settings-dialog"].close();
}

let settingsSaveTimer = null;
function persistSettings() {
  const form = elements["settings-form"];
  if (!form.checkValidity()) { elements["settings-saved"].textContent = "Check highlighted fields"; return; }
  try {
    if (!preferenceStorage) throw new Error("Storage unavailable");
    state.preferences = savePreferences(preferenceStorage, preferencesFromForm(), preferencesStorageKey);
    state.savedPreferences = state.preferences;
    applyPreferences(state.preferences);
    refreshWeather().catch(() => {});
    elements["settings-saved"].textContent = "Saved on this device";
  } catch {
    elements["settings-saved"].textContent = "Could not save";
  }
}

function scheduleSettingsSave(delay = 0) {
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  elements["settings-saved"].textContent = "Saving…";
  settingsSaveTimer = setTimeout(() => { settingsSaveTimer = null; persistSettings(); }, delay);
}

async function initialize() {
  applyPreferences(state.preferences);
  refreshWeather().catch(() => {});
  initializeBroll();
  if (!cleanOutputEnabled()) setTimeout(dismissWelcome, 2600);
  const [configResponse, latestResponse] = await Promise.all([
    fetch(streamApi("/api/config")),
    fetch(streamApi("/api/telemetry/latest")),
  ]);
  state.config = await configResponse.json();
  const latest = await latestResponse.json();
  state.simulatorRunning = latest.simulator.running;
  renderSimulatorState();
  elements["rtmp-url"].textContent = state.config.rtmpUrl;
  elements["settings-rtmp-url"].textContent = state.config.rtmpServerUrl;
  elements["telemetry-endpoint"].textContent = `Receiver endpoint: ${state.config.telemetryUrl}`;
  reloadVideo();
  if (latest.telemetry) updateTelemetry(latest.telemetry);

  const events = new EventSource(streamApi("/api/events"));
  events.addEventListener("telemetry", (event) => updateTelemetry(JSON.parse(event.data)));
  events.onerror = () => setStatus(elements["telemetry-status"], "stale", "Receiver reconnecting");

  await refreshStreamStatus();
  setInterval(refreshStreamStatus, 2500);
  setInterval(updateFreshness, 1000);
  setInterval(() => { renderWeather(); refreshWeather().catch(() => {}); }, 60_000);
}

elements["drone-model"].addEventListener("change", updateWeatherModelNote);
elements["weather-place-search"].addEventListener("click", async () => {
  const query = elements["weather-place-query"].value.trim();
  const results = elements["weather-place-results"];
  results.replaceChildren();
  if (query.length < 3) { results.textContent = "Enter at least three letters."; return; }
  results.textContent = "Searching…";
  try {
    const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error("Search unavailable");
    const { places } = await response.json();
    results.replaceChildren();
    if (!places.length) { results.textContent = "No places found. Try another name."; return; }
    for (const place of places) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "weather-place-option";
      button.textContent = [place.name, place.region, place.country].filter(Boolean).join(", ");
      button.addEventListener("click", () => {
        const form = elements["settings-form"];
        form.elements.namedItem("weatherLatitude").value = place.latitude;
        form.elements.namedItem("weatherLongitude").value = place.longitude;
        elements["weather-settings-result"].textContent = `${button.textContent} selected and saved. Weather will refresh if the overlay is enabled.`;
        results.replaceChildren();
        scheduleSettingsSave();
      });
      results.append(button);
    }
  } catch { results.textContent = "Place search is unavailable. Try again or enter coordinates."; }
});
elements["weather-place-query"].addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); elements["weather-place-search"].click(); }
});
elements["weather-use-location"].addEventListener("click", () => {
  const status = elements["weather-settings-result"];
  if (!navigator.geolocation || !window.isSecureContext) { status.textContent = "Device location needs HTTPS or localhost. Use place search, or enter coordinates."; return; }
  status.textContent = "Requesting device location…";
  navigator.geolocation.getCurrentPosition((position) => {
    elements["settings-form"].elements.namedItem("weatherLatitude").value = position.coords.latitude.toFixed(6);
    elements["settings-form"].elements.namedItem("weatherLongitude").value = position.coords.longitude.toFixed(6);
    status.textContent = "Location selected and saved.";
    scheduleSettingsSave();
  }, () => { status.textContent = "Device location unavailable here. Enter coordinates manually."; }, { enableHighAccuracy: true, timeout: 10_000 });
});
elements["weather-check"].addEventListener("click", async () => {
  const form = elements["settings-form"];
  const latitude = form.elements.namedItem("weatherLatitude").value;
  const longitude = form.elements.namedItem("weatherLongitude").value;
  const status = elements["weather-settings-result"];
  if (latitude === "" || longitude === "" || !form.checkValidity()) { status.textContent = "Enter valid latitude and longitude first."; return; }
  status.textContent = "Checking conditions…";
  const coordinates = { latitude: Number(latitude), longitude: Number(longitude) };
  await refreshWeather({ force: true, coordinates });
  const key = `${coordinates.latitude},${coordinates.longitude}`;
  const profile = droneProfile(form.elements.namedItem("droneModel").value);
  const pilot = Number(form.elements.namedItem("pilotLimitMps").value) || null;
  const assessment = state.weatherKey === key ? assessWeather(state.weatherData, profile.id, pilot) : null;
  status.textContent = assessment ? `${assessment.label}: ${assessment.reason} ${WEATHER_DISCLAIMER}` : "Weather unavailable. Check your connection and try again.";
});

elements["copy-url"].addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements["rtmp-url"].textContent);
    showToast("RTMP address copied");
  } catch {
    showToast("Select and copy the RTMP address manually");
  }
});
elements["settings-copy-url"].addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements["settings-rtmp-url"].textContent);
    showToast("RTMP address copied");
  } catch {
    showToast("Select and copy the RTMP address manually");
  }
});
elements["clean-output-copy"].addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements["clean-output-url"].textContent);
    showToast("Clean output link copied");
  } catch {
    showToast("Select and copy the clean output link manually");
  }
});
elements["settings-new-key"].addEventListener("click", () => {
  elements["settings-stream-key"].value = randomStreamKey();
  try { preferenceStorage?.setItem(pendingStreamKeyStorageKey, elements["settings-stream-key"].value); } catch { }
  updateConnectionLinks();
});
elements["settings-stream-key"].addEventListener("input", () => {
  const key = elements["settings-stream-key"].value.trim().toLowerCase();
  if (streamKeyPattern.test(key)) {
    try { preferenceStorage?.setItem(pendingStreamKeyStorageKey, key); } catch { }
  }
  updateConnectionLinks();
});
elements["settings-switch-feed"].addEventListener("click", () => {
  const streamKey = elements["settings-stream-key"].value.trim().toLowerCase();
  if (!streamKeyPattern.test(streamKey)) {
    showToast("Use 1–16 lowercase letters, numbers, or hyphens");
    return;
  }
  const url = new URL(window.location.href);
  if (streamKey === "x") url.searchParams.delete("stream");
  else url.searchParams.set("stream", streamKey);
  window.location.assign(url);
});
elements["reload-video"].addEventListener("click", reloadVideo);
elements["demo-button"].addEventListener("click", () => toggleSimulator().catch(() => showToast("Could not change demo state")));
elements["settings-button"].addEventListener("click", () => openSettings());
elements["edit-identity"].addEventListener("click", () => openSettings(true));
elements["settings-close"].addEventListener("click", closeSettings);
elements["settings-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  scheduleSettingsSave();
});
elements["settings-form"].addEventListener("change", (event) => {
  if (event.target.name === "rawOutput") updateCleanOutputLink(event.target.checked);
  if (event.target.id === "settings-stream-key") { updateConnectionLinks(); return; }
  if (event.target.id === "weather-place-query") return;
  scheduleSettingsSave();
});
elements["settings-form"].addEventListener("input", (event) => {
  if (event.target.id === "settings-stream-key") { updateConnectionLinks(); return; }
  if (event.target.id === "weather-place-query") return;
  scheduleSettingsSave(event.target.type === "text" || event.target.type === "number" ? 250 : 0);
});
elements["reset-settings"].addEventListener("click", () => {
  try { preferenceStorage?.removeItem(pendingStreamKeyStorageKey); } catch { }
  fillSettings(DEFAULT_PREFERENCES);
  state.savedPreferences = { ...state.savedPreferences, overlayLayout: DEFAULT_PREFERENCES.overlayLayout };
  scheduleSettingsSave();
  showToast("Default settings restored");
});
elements["reset-overlay-layout"].addEventListener("click", () => {
  try {
    state.savedPreferences = savePreferences(preferenceStorage, { ...state.savedPreferences, overlayLayout: DEFAULT_PREFERENCES.overlayLayout }, preferencesStorageKey);
    state.preferences = state.savedPreferences;
    applyOverlayLayout();
    showToast("Overlay positions reset");
  } catch { showToast("Overlay positions could not be saved"); }
});
elements["settings-dialog"].addEventListener("cancel", (event) => {
  event.preventDefault();
  closeSettings();
});
elements["settings-dialog"].addEventListener("click", (event) => {
  if (event.target === elements["settings-dialog"]) closeSettings();
});
elements["skip-welcome"]?.addEventListener("click", dismissWelcome);
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === ",") {
    event.preventDefault();
    if (!elements["settings-dialog"].open) openSettings();
  }
});
colorSchemeQuery.addEventListener("change", () => {
  if (state.preferences.theme === "system") updateBrowserChrome();
});

initialize().catch((error) => {
  console.error(error);
  showToast("Dashboard backend is unavailable");
});
