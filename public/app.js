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
import { createLocationMap } from "./location-map.js";

const elementIds = [
  "video-status", "telemetry-status", "video-frame", "video-placeholder", "live-badge", "live-badge-label", "stream-health", "stream-health-label", "stream-health-detail", "setup-guide-status", "setup-check",
  "rtmp-url", "copy-url", "reload-video", "freshness", "freshness-label", "source-badge",
  "height-value", "height-unit", "speed-value", "speed-unit", "distance-value", "distance-unit",
  "course-value", "course-arrow", "bearing-value", "signal-value", "uas-id", "operator-id",
  "position-value", "demo-button", "demo-label", "telemetry-endpoint", "track-line",
  "aircraft-marker", "track-empty", "scale-label", "toast", "aircraft-name", "settings-button",
  "settings-dialog", "settings-form", "settings-close", "settings-saved", "reset-settings", "reset-overlay-layout", "edit-identity",
  "track-panel", "identity-section", "signal-metric", "uas-override-badge", "operator-override-badge",
  "settings-rtmp-url", "settings-copy-url", "settings-stream-key", "settings-new-key", "settings-switch-feed", "settings-viewer-url", "telemetry-panel",
  "placeholder-reel-a", "placeholder-reel-b", "welcome-screen", "skip-welcome", "clean-output-note", "clean-output-url", "clean-output-copy", "clean-output-open", "settings-full-rtmp-url",
  "drone-model", "weather-model-note", "weather-panel", "weather-status", "weather-alert", "weather-alert-title", "weather-alert-detail", "weather-freshness", "briefing-map-region", "briefing-map", "briefing-map-tiles", "briefing-map-wind-arrow", "briefing-coordinate", "briefing-wind-arrow", "briefing-wind-copy", "weather-model", "weather-condition", "weather-wind", "weather-gust", "weather-wind-80", "weather-wind-120", "weather-rain", "weather-visibility", "weather-direction", "weather-temperature", "weather-cloud", "weather-reason", "weather-icon", "weather-age", "wind-meter", "wind-marker", "weather-wind-chart", "weather-wind-chart-range", "weather-chart-limit-label", "outlook-calmest", "outlook-calmest-detail", "outlook-rain", "outlook-rain-detail", "outlook-shear", "outlook-shear-detail", "outlook-light-label", "outlook-light", "outlook-light-detail", "best-window", "best-window-mark", "best-window-title", "best-window-detail", "best-window-tag", "weather-hourly-section", "weather-hourly-range", "weather-hourly-list", "weather-disclaimer", "weather-check", "weather-use-location", "weather-settings-result", "weather-place-query", "weather-place-search", "weather-place-results", "weather-map-details", "weather-map", "weather-map-tiles", "weather-map-zoom-in", "weather-map-zoom-out",
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
  videoEverLive: false,
  streamServerReachable: null,
  streamStatusReason: null,
  streamBytesReceived: null,
  streamObservedAt: null,
  lastStreamDataAt: null,
  toastTimer: null,
  preferences: loadPreferences(preferenceStorage, preferencesStorageKey),
  savedPreferences: loadPreferences(preferenceStorage, preferencesStorageKey),
  weatherData: null,
  weatherKey: null,
  weatherError: null,
  weatherRequest: 0,
  briefingMapKey: null,
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
  const initialY = name === "weather" ? top : name === "telemetry" ? top + (state.preferences.weather.enabled ? 258 : 0) : trackY;
  const compactTelemetryHeight = state.preferences.panels.track ? clamp(trackY - initialY - 12, 120, 250) : 250;
  const defaultHeight = name === "weather" ? 244 : name === "telemetry" ? compact ? compactTelemetryHeight : 480 : compact ? 165 : 255;
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

function weatherIcon(code, isDay = true) {
  if (code >= 95) return "⚡";
  if (code >= 51) return "☂";
  if (code === 45 || code === 48) return "≋";
  if (isDay === false && code <= 1) return "☾";
  if (isDay === false && code === 2) return "☾";
  if (code === 0 || code === 1) return "☼";
  if (code >= 2) return "☁";
  return "◌";
}

function renderWindProfile(data, limit) {
  const host = elements["weather-wind-chart"];
  const renderKey = `${data?.latitude ?? ""},${data?.longitude ?? ""}:${data?.fetchedAt ?? "empty"}:${limit ?? "unknown"}:${state.preferences.units}`;
  if (host.dataset.renderKey === renderKey) return;
  host.dataset.renderKey = renderKey;
  const windUnit = state.preferences.units === "aviation" ? "kt" : "m/s";
  elements["weather-wind-chart-range"].textContent = `Hourly model · ${windUnit} · 10–120 m`;
  elements["weather-chart-limit-label"].textContent = Number.isFinite(limit) ? `Limit ${windDisplay(limit)}` : "No aircraft limit";
  host.replaceChildren();
  const hours = Array.isArray(data?.hourly) ? data.hourly : [];
  if (hours.length < 2) {
    const empty = document.createElement("p");
    empty.className = "weather-chart-empty";
    empty.textContent = data ? "Hourly wind profile is unavailable for this location." : "Choose a location in Settings to load the wind profile.";
    host.append(empty);
    return;
  }
  const namespace = "http://www.w3.org/2000/svg";
  const make = (tag, attrs = {}, content = "") => {
    const node = document.createElementNS(namespace, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    if (content) node.textContent = content;
    return node;
  };
  const svg = make("svg", { viewBox: "0 0 760 194", role: "img", "aria-label": "Hourly wind forecast at 10, 80 and 120 metres with aircraft wind limit" });
  svg.append(make("title", {}, "Modelled hourly wind by altitude"));
  const left = 48, right = 748, top = 13, bottom = 154;
  const allValues = hours.flatMap((hour) => [hour.windMps, hour.wind80Mps, hour.wind120Mps]).filter(Number.isFinite);
  const rawLimit = Number.isFinite(limit) ? limit : 0;
  const maximumMps = Math.max(10, rawLimit, ...allValues);
  const axisMaxMps = Math.ceil(maximumMps / 5) * 5;
  const factor = state.preferences.units === "aviation" ? 1.94384 : 1;
  const axisMax = axisMaxMps * factor;
  const height = bottom - top;
  const plotX = (index) => left + (hours.length < 2 ? 0 : index / (hours.length - 1)) * (right - left);
  const plotY = (value) => bottom - (value * factor / axisMax) * height;
  for (const tick of [0, axisMax / 2, axisMax]) {
    const y = plotY(tick / factor);
    svg.append(make("line", { x1: left, x2: right, y1: y, y2: y, class: "chart-grid-line" }));
    svg.append(make("text", { x: left - 9, y: y + 4, class: "chart-axis-label", "text-anchor": "end" }, `${Math.round(tick)}`));
  }
  if (rawLimit > 0) {
    const limitY = plotY(rawLimit);
    svg.append(make("line", { x1: left, x2: right, y1: limitY, y2: limitY, class: "chart-limit-line" }));
  }
  const nowIndex = hours.reduce((best, hour, index) => Math.abs(Date.parse(hour.time) - Date.now()) < Math.abs(Date.parse(hours[best].time) - Date.now()) ? index : best, 0);
  const nowX = plotX(nowIndex);
  svg.append(make("line", { x1: nowX, x2: nowX, y1: top, y2: bottom, class: "chart-now-line" }));
  const series = [
    { name: "10 m", field: "windMps", className: "chart-line-10" },
    { name: "80 m", field: "wind80Mps", className: "chart-line-80" },
    { name: "120 m", field: "wind120Mps", className: "chart-line-120" },
  ];
  for (const line of series) {
    const points = hours.map((hour, index) => Number.isFinite(hour[line.field]) ? `${plotX(index)},${plotY(hour[line.field])}` : null).filter(Boolean).join(" ");
    if (points) svg.append(make("polyline", { points, class: `chart-wind-line ${line.className}`, pathLength: 1 }));
  }
  for (const index of new Set([0, nowIndex, hours.length - 1])) {
    const date = new Date(hours[index].time);
    const label = index === nowIndex ? "NOW" : new Intl.DateTimeFormat(undefined, date.toDateString() === new Date().toDateString() ? { hour: "numeric" } : { weekday: "short", hour: "numeric" }).format(date);
    svg.append(make("text", { x: plotX(index), y: 181, class: index === nowIndex ? "chart-now-label" : "chart-axis-label", "text-anchor": index === 0 ? "start" : index === hours.length - 1 ? "end" : "middle" }, label));
  }
  host.append(svg);
}

function renderPlanningCues(data) {
  const hours = Array.isArray(data?.hourly) ? data.hourly : [];
  const now = Date.now();
  const upcoming = hours.filter((hour) => Date.parse(hour.time) >= now);
  const peakWind = (hour) => Math.max(...[hour.windMps, hour.wind80Mps, hour.wind120Mps, hour.gustMps].filter(Number.isFinite));
  const calmest = upcoming.filter((hour) => Number.isFinite(peakWind(hour))).sort((a, b) => peakWind(a) - peakWind(b))[0];
  const rainPeak = upcoming.filter((hour) => Number.isFinite(hour.rainProbabilityPct)).sort((a, b) => b.rainProbabilityPct - a.rainProbabilityPct)[0];
  const timeLabel = (time) => new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(time));
  elements["outlook-calmest"].textContent = calmest ? timeLabel(calmest.time) : "—";
  elements["outlook-calmest-detail"].textContent = calmest ? `${windDisplay(peakWind(calmest))} peak wind` : "No hourly data";
  elements["outlook-rain"].textContent = rainPeak ? `${Math.round(rainPeak.rainProbabilityPct)}%` : "—";
  elements["outlook-rain-detail"].textContent = rainPeak ? `Highest chance · ${timeLabel(rainPeak.time)}` : "No rain probability data";
  const shear = Number.isFinite(data?.wind120Mps) && Number.isFinite(data?.windMps) ? data.wind120Mps - data.windMps : null;
  elements["outlook-shear"].textContent = shear === null ? "—" : `${shear > 0 ? "+" : shear < 0 ? "−" : ""}${windDisplay(Math.abs(shear))}`;
  elements["outlook-shear-detail"].textContent = shear === null ? "Altitude wind unavailable" : shear >= 0 ? "Builds from 10 m to 120 m" : "Eases from 10 m to 120 m";
  const nowHour = hours.reduce((best, hour) => Math.abs(Date.parse(hour.time) - now) < Math.abs(Date.parse(best.time) - now) ? hour : best, hours[0]);
  const daylight = data?.isDay ?? nowHour?.isDay;
  const event = daylight === false ? data?.nextSunrise : data?.nextSunset;
  elements["outlook-light-label"].textContent = daylight === false ? "NEXT SUNRISE" : "NEXT SUNSET";
  elements["outlook-light"].textContent = event ? timeLabel(event) : "—";
  elements["outlook-light-detail"].textContent = event ? "Local time estimate" : "Daylight data unavailable";
}

function renderBestWindow(data, limit, ageMinutes) {
  const host = elements["best-window"];
  const set = (level, title, detail, tag, mark) => {
    host.dataset.level = level;
    elements["best-window-title"].textContent = title;
    elements["best-window-detail"].textContent = detail;
    elements["best-window-tag"].textContent = tag;
    elements["best-window-mark"].textContent = mark;
  };
  const hours = Array.isArray(data?.hourly) ? data.hourly : [];
  if (!data || !hours.length) return set("unknown", "Forecast unavailable", "Choose a location and refresh the weather forecast.", "NO DATA", "!");
  if (ageMinutes > 10) return set("stale", "Forecast needs refreshing", `Last update ${Math.floor(ageMinutes)} min ago · check current conditions before flying.`, "STALE", "↻");
  if (!Number.isFinite(limit) || limit <= 0) return set("unknown", "Choose an aircraft", "Select a model in Settings to estimate a favourable window.", "SET MODEL", "◇");
  const now = Date.now();
  const timeLabel = (value) => new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(value));
  const peakWind = (hour) => Math.max(...[hour.windMps, hour.wind80Mps, hour.wind120Mps, hour.gustMps].filter(Number.isFinite));
  const upcoming = hours.filter((hour) => Date.parse(hour.time) >= now);
  const rated = upcoming.map((hour) => {
    const peak = peakWind(hour);
    const precipitation = Number.isFinite(hour.weatherCode) && ([45, 48].includes(hour.weatherCode) || hour.weatherCode >= 51);
    const noGo = (Number.isFinite(peak) && peak >= limit) || (Number.isFinite(hour.visibilityM) && hour.visibilityM < 1000) || precipitation;
    const missing = !Number.isFinite(peak) || !Number.isFinite(hour.visibilityM) || !Number.isFinite(hour.rainProbabilityPct);
    const caution = !noGo && (missing || peak >= limit * .7 || hour.visibilityM < 3000 || hour.rainProbabilityPct >= 60 || hour.isDay === false);
    return { hour, peak, level: noGo ? "no-go" : caution ? "caution" : "favourable" };
  });
  const favourable = rated.filter((entry) => entry.level === "favourable");
  const windows = [];
  for (const entry of favourable) {
    const prior = windows.at(-1);
    if (prior && Date.parse(entry.hour.time) - Date.parse(prior.at(-1).hour.time) <= 90 * 60_000) prior.push(entry);
    else windows.push([entry]);
  }
  const best = windows.filter((window) => window.length >= 2).sort((a, b) => b.length - a.length || a.reduce((sum, item) => sum + item.peak, 0) / a.length - b.reduce((sum, item) => sum + item.peak, 0) / b.length)[0];
  if (best) {
    const first = best[0].hour.time, last = best.at(-1).hour.time;
    const mean = best.reduce((sum, item) => sum + item.peak, 0) / best.length;
    return set("favourable", `${best.length} h favourable · ${timeLabel(first)}–${timeLabel(last)}`, `Peak wind averages ${windDisplay(mean)} · forecast estimate only.`, "GOOD WINDOW", "✓");
  }
  const short = favourable[0];
  if (short) return set("caution", `Short favourable window · ${timeLabel(short.hour.time)}`, `About one hour · peak wind ${windDisplay(short.peak)}.`, "SHORT WINDOW", "◷");
  const calm = rated.filter((entry) => Number.isFinite(entry.peak)).sort((a, b) => a.peak - b.peak)[0];
  if (!calm) return set("unknown", "Forecast is incomplete", "No usable hourly wind values are available.", "NO DATA", "!");
  return set("no-go", `No favourable window · calmest ${timeLabel(calm.hour.time)}`, `${calm.level === "no-go" ? "Wind, rain or visibility exceeds the selected guidance." : "Conditions remain marginal across this forecast."} Estimate only · not flight clearance.`, "NO WINDOW", "!");
}

function renderHourlyWeather(data, limit) {
  const list = elements["weather-hourly-list"];
  const renderKey = `${data?.latitude ?? ""},${data?.longitude ?? ""}:${data?.fetchedAt ?? "empty"}:${limit ?? "unknown"}:${state.preferences.units}`;
  if (list.dataset.renderKey === renderKey) return;
  list.dataset.renderKey = renderKey;
  list.replaceChildren();
  const hours = Array.isArray(data?.hourly) ? data.hourly : [];
  const now = Date.now();
  if (!hours.length) {
    const empty = document.createElement("p");
    empty.className = "weather-hourly-empty";
    empty.textContent = "Hourly forecast unavailable for this location.";
    list.append(empty);
    elements["weather-hourly-range"].textContent = "Forecast unavailable";
    return;
  }
  let nowCard = null;
  const nearestIndex = hours.reduce((best, hour, index) => Math.abs(Date.parse(hour.time) - now) < Math.abs(Date.parse(hours[best].time) - now) ? index : best, 0);
  for (const [index, hour] of hours.entries()) {
    const card = document.createElement("article");
    const timestamp = Date.parse(hour.time);
    const date = new Date(timestamp);
    const ratingKnown = Number.isFinite(limit) && limit > 0;
    const peak = Math.max(...[hour.windMps, hour.wind80Mps, hour.wind120Mps, hour.gustMps].filter(Number.isFinite));
    const precipitation = Number.isFinite(hour.weatherCode) && ([45, 48].includes(hour.weatherCode) || hour.weatherCode >= 51);
    const noGo = (ratingKnown && peak >= limit) || (Number.isFinite(hour.visibilityM) && hour.visibilityM < 1000) || precipitation;
    const missing = ![hour.windMps, hour.wind80Mps, hour.wind120Mps, hour.visibilityM, hour.rainProbabilityPct].every(Number.isFinite);
    const caution = !noGo && (Number.isFinite(limit) && peak >= limit * .7 || Number.isFinite(hour.rainProbabilityPct) && hour.rainProbabilityPct >= 60 || Number.isFinite(hour.visibilityM) && hour.visibilityM < 3000 || hour.isDay === false);
    card.className = "weather-hour-card";
    card.dataset.level = !ratingKnown ? "unknown" : noGo ? "no-go" : missing ? "unknown" : caution ? "caution" : "favourable";
    card.setAttribute("role", "listitem");
    const label = document.createElement("div");
    label.className = "weather-hour-label";
    const timeLabel = document.createElement("span");
    const crossesDay = date.toDateString() !== new Date(now).toDateString();
    timeLabel.textContent = index === nearestIndex ? "NOW" : new Intl.DateTimeFormat(undefined, crossesDay ? { weekday: "short", hour: "numeric" } : { hour: "numeric" }).format(date);
    const riskLabel = document.createElement("span");
    riskLabel.className = "weather-hour-risk";
    riskLabel.textContent = !ratingKnown ? "SET MODEL" : noGo ? "CHECK" : missing ? "PARTIAL" : caution ? "WATCH" : "GOOD";
    label.append(timeLabel, riskLabel);
    if (index === nearestIndex) { card.classList.add("is-now"); nowCard = card; }
    if (timestamp < now - 45 * 60_000) card.classList.add("is-past");
    const condition = document.createElement("div");
    condition.className = "weather-hour-condition";
    condition.textContent = `${weatherIcon(hour.weatherCode, hour.isDay)} ${hour.isDay === false ? "Night · " : ""}${weatherDescription(hour.weatherCode)}`;
    const peakTrack = document.createElement("div");
    peakTrack.className = "timeline-wind-track";
    peakTrack.setAttribute("aria-label", `Peak wind ${Number.isFinite(peak) ? windDisplay(peak) : "unavailable"} against ${ratingKnown ? windDisplay(limit) : "no selected aircraft limit"}`);
    const peakFill = document.createElement("i");
    peakFill.style.width = ratingKnown && Number.isFinite(peak) ? `${Math.min(100, Math.max(4, peak / limit * 100))}%` : "0%";
    peakTrack.append(peakFill);
    const winds = document.createElement("div");
    winds.className = "weather-hour-winds";
    for (const [name, value] of [["10m", hour.windMps], ["80m", hour.wind80Mps], ["120m", hour.wind120Mps]]) {
      const metric = document.createElement("div");
      const nameNode = document.createElement("span");
      nameNode.textContent = name;
      const strong = document.createElement("strong");
      strong.textContent = Number.isFinite(value) ? windDisplay(value) : "—";
      metric.append(nameNode, strong);
      winds.append(metric);
    }
    const details = document.createElement("div");
    details.className = "weather-hour-details";
    for (const [name, value] of [["GUST", Number.isFinite(hour.gustMps) ? windDisplay(hour.gustMps) : "—"], ["RAIN", Number.isFinite(hour.rainProbabilityPct) ? `${hour.rainProbabilityPct}%` : "—"], ["VIS", Number.isFinite(hour.visibilityM) ? `${(hour.visibilityM / 1000).toFixed(1)} km` : "—"]]) {
      const metric = document.createElement("div");
      const labelNode = document.createElement("span");
      labelNode.textContent = name;
      const valueNode = document.createElement("strong");
      valueNode.textContent = value;
      metric.append(labelNode, valueNode);
      details.append(metric);
    }
    card.title = `Wind 10 m ${windDisplay(hour.windMps)} · 80 m ${windDisplay(hour.wind80Mps)} · 120 m ${windDisplay(hour.wind120Mps)} · gust ${windDisplay(hour.gustMps)} · rain ${Number.isFinite(hour.rainProbabilityPct) ? `${hour.rainProbabilityPct}%` : "unavailable"} · visibility ${Number.isFinite(hour.visibilityM) ? `${(hour.visibilityM / 1000).toFixed(1)} km` : "unavailable"}`;
    card.append(label, condition, peakTrack, winds, details);
    list.append(card);
  }
  elements["weather-hourly-range"].textContent = "Past 3 h · next 12 h";
}

function updateWeatherAlertInputs() {
  const form = elements["settings-form"];
  const enabled = form.elements.namedItem("weatherAlertsEnabled").checked;
  for (const name of ["weatherAlertWindMps", "weatherAlertGustMps", "weatherAlertRainPct", "weatherAlertVisibilityKm"]) {
    form.elements.namedItem(name).disabled = !enabled;
  }
}

function renderWeatherAlerts(data, ageMinutes) {
  const host = elements["weather-alert"];
  const preferences = state.preferences.weather.alerts;
  host.hidden = false;
  if (!data) {
    host.hidden = true;
    return;
  }
  if (ageMinutes > 10) {
    host.dataset.level = "stale";
    elements["weather-alert-title"].textContent = "Forecast stale";
    elements["weather-alert-detail"].textContent = `Updated ${Math.floor(ageMinutes)} min ago · check conditions again`;
    return;
  }
  if (!preferences.enabled) {
    host.hidden = true;
    return;
  }

  const alerts = [];
  const add = (label, value, threshold, thresholdText, direction = "maximum") => {
    if (!Number.isFinite(value) || !Number.isFinite(threshold)) return;
    const crossed = direction === "maximum" ? value >= threshold : value <= threshold;
    const approaching = direction === "maximum" ? value >= threshold * 0.8 : value <= threshold * 1.2;
    if (crossed || approaching) alerts.push({ crossed, text: `${label} ${crossed ? "above" : "near"} ${thresholdText}` });
  };
  const winds = [data.windMps, data.wind80Mps, data.wind120Mps].filter(Number.isFinite);
  add("Wind", winds.length ? Math.max(...winds) : null, preferences.windMps, windDisplay(preferences.windMps));
  add("Gust", data.gustMps, preferences.gustMps, windDisplay(preferences.gustMps));
  if (Number.isFinite(data.rainProbabilityPct) && Number.isFinite(preferences.rainProbabilityPct)) {
    const crossed = data.rainProbabilityPct >= preferences.rainProbabilityPct;
    const approaching = data.rainProbabilityPct >= preferences.rainProbabilityPct * 0.8;
    if (crossed || approaching) alerts.push({ crossed, text: `Rain ${Math.round(data.rainProbabilityPct)}% · ${crossed ? "limit reached" : "approaching"}` });
  }
  if (Number.isFinite(data.visibilityM) && Number.isFinite(preferences.minimumVisibilityKm)) {
    const visibilityKm = data.visibilityM / 1000;
    const crossed = visibilityKm <= preferences.minimumVisibilityKm;
    const approaching = visibilityKm <= preferences.minimumVisibilityKm * 1.2;
    if (crossed || approaching) alerts.push({ crossed, text: `Visibility ${visibilityKm.toFixed(1)} km · ${crossed ? "below minimum" : "approaching"}` });
  }
  if (!alerts.length) {
    host.hidden = true;
    return;
  }
  const crossed = alerts.some((alert) => alert.crossed);
  host.dataset.level = crossed ? "exceeded" : "approaching";
  elements["weather-alert-title"].textContent = crossed ? "Threshold reached" : "Conditions approaching limit";
  elements["weather-alert-detail"].textContent = alerts.slice(0, 2).map((alert) => alert.text).join(" · ");
}

function syncBriefingMap(data) {
  const preferences = state.preferences;
  const key = weatherLocationKey(preferences);
  const show = preferences.displayMode === "detailed" && preferences.weather.enabled && preferences.weather.display === "split" && Boolean(key) && !cleanOutputEnabled();
  elements["briefing-map-region"].hidden = !show;
  if (!show) return;
  if (state.briefingMapKey !== key) {
    const [latitude, longitude] = key.split(",").map(Number);
    briefingLocationMap.setCenter(latitude, longitude);
    briefingLocationMap.open();
    state.briefingMapKey = key;
  }
  const [latitude, longitude] = key.split(",").map(Number);
  elements["briefing-coordinate"].textContent = `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°`;
  const direction = Number.isFinite(data?.directionDeg) ? Math.round(data.directionDeg / 22.5) % 16 : null;
  const compass = direction === null ? null : ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][direction];
  elements["briefing-wind-copy"].textContent = compass && Number.isFinite(data?.windMps) ? `From ${compass} · ${windDisplay(data.windMps)}` : "Wind unavailable";
  elements["briefing-wind-arrow"].style.transform = `rotate(${Number.isFinite(data?.directionDeg) ? (data.directionDeg + 180) % 360 : 0}deg)`;
  elements["briefing-wind-arrow"].classList.toggle("available", compass !== null);
  elements["briefing-map-wind-arrow"].style.transform = `rotate(${Number.isFinite(data?.directionDeg) ? (data.directionDeg + 180) % 360 : 0}deg)`;
  elements["briefing-map-wind-arrow"].classList.toggle("available", compass !== null);
}

function renderWeather() {
  const panel = elements["weather-panel"];
  const prefs = state.preferences;
  panel.classList.toggle("preference-hidden", !prefs.weather.enabled);
  const profile = droneProfile(prefs.droneModel);
  elements["weather-model"].textContent = profile.name;
  const key = weatherLocationKey(prefs);
  const data = key === state.weatherKey ? state.weatherData : null;
  const ageMinutes = data ? Math.max(0, (Date.now() - Date.parse(data.fetchedAt)) / 60_000) : Infinity;
  const assessment = data && ageMinutes <= 30 ? assessWeather(data, profile.id, prefs.weather.pilotLimitMps) : null;
  const level = assessment?.level ?? "unknown";
  panel.dataset.level = level;
  elements["weather-status"].textContent = data && ageMinutes > 10
    ? `STALE ${Math.floor(ageMinutes)}m`
    : level === "unknown" && data
    ? (profile.id === "none" && !Number.isFinite(prefs.weather.pilotLimitMps) ? "SET MODEL" : "SET LIMIT")
    : { favourable: "LOW RISK*", caution: "CAUTION", "no-go": "DO NOT FLY", unknown: key ? state.weatherError || "NO DATA" : "SET LOCATION" }[level];
  elements["weather-status"].classList.toggle("stale", ageMinutes > 10);
  elements["weather-condition"].textContent = data ? weatherDescription(data.weatherCode) : key ? "Weather unavailable" : "Set location";
  elements["weather-reason"].textContent = assessment?.reason ?? (key ? "Weather unavailable. Check Settings." : "Choose a weather location in Settings.");
  elements["weather-icon"].textContent = data ? weatherIcon(data.weatherCode, data.isDay) : "◌";
  elements["weather-wind"].textContent = windDisplay(data?.windMps);
  elements["weather-gust"].textContent = windDisplay(data?.gustMps);
  elements["weather-wind-80"].textContent = windDisplay(data?.wind80Mps);
  elements["weather-wind-120"].textContent = windDisplay(data?.wind120Mps);
  elements["weather-rain"].textContent = Number.isFinite(data?.rainProbabilityPct) ? `${data.rainProbabilityPct}%` : "—";
  elements["weather-visibility"].textContent = Number.isFinite(data?.visibilityM) ? `${(data.visibilityM / 1000).toFixed(1)} km` : "—";
  const direction = Number.isFinite(data?.directionDeg) ? Math.round(data.directionDeg / 22.5) % 16 : null;
  elements["weather-direction"].textContent = direction === null ? "—" : `${["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][direction]} · ${Math.round(data.directionDeg)}°`;
  elements["weather-temperature"].textContent = Number.isFinite(data?.temperatureC) ? `${data.temperatureC.toFixed(1)}°C` : "—";
  elements["weather-cloud"].textContent = Number.isFinite(data?.cloudCoverPct) ? `${Math.round(data.cloudCoverPct)}%` : "—";
  const limit = assessment?.limitMps ?? profile.maxWindMps;
  renderWindProfile(data, limit);
  renderPlanningCues(data);
  renderBestWindow(data, limit, ageMinutes);
  renderHourlyWeather(data, limit);
  const ratio = data && Number.isFinite(limit) && limit > 0 ? Math.min(100, Math.max(0, Math.max(data.windMps, data.gustMps, ...[data.wind80Mps, data.wind120Mps].filter(Number.isFinite)) / limit * 100)) : null;
  elements["wind-meter"].classList.toggle("empty", ratio === null || level === "unknown");
  elements["wind-meter"].setAttribute("aria-valuenow", ratio === null || level === "unknown" ? "0" : String(Math.round(ratio)));
  elements["wind-meter"].setAttribute("aria-valuetext", ratio === null || level === "unknown" ? "No current wind assessment" : `Peak wind ${Math.round(ratio)}% of ${windDisplay(limit)} limit`);
  elements["wind-marker"].style.left = `${ratio ?? 0}%`;
  const freshness = !key ? "Set location" : !data ? state.weatherError ? "Unavailable" : "Forecast waiting" : ageMinutes > 10 ? `Stale · ${Math.floor(ageMinutes)}m` : `Updated ${Math.floor(ageMinutes)}m ago`;
  elements["weather-age"].textContent = freshness;
  elements["weather-freshness"].textContent = freshness;
  elements["weather-freshness"].dataset.state = data && ageMinutes > 10 ? "stale" : data ? "fresh" : "waiting";
  renderWeatherAlerts(data, ageMinutes);
  syncBriefingMap(data);
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
  return window.location.pathname === "/output" || new URLSearchParams(window.location.search).get("output") === "clean";
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
  const oldDisplayMode = state.preferences?.weather?.display;
  const oldWeatherEnabled = state.preferences?.weather?.enabled;
  const normalized = normalizePreferences(preferences);
  document.documentElement.dataset.theme = normalized.theme;
  document.documentElement.dataset.accent = normalized.accent;
  elements["aircraft-name"].textContent = normalized.aircraftName;
  document.title = `AEROLINK — ${normalized.aircraftName}`;
  elements["track-panel"].classList.toggle("preference-hidden", !normalized.panels.track);
  elements["telemetry-panel"]?.classList.toggle("preference-hidden", !normalized.panels.overlay);
  state.preferences = normalized;
  document.documentElement.classList.toggle("beginner-mode", normalized.displayMode === "beginner");
  const splitWeather = normalized.weather.enabled && normalized.weather.display === "split" && !cleanOutputEnabled();
  const wasSplitWeather = document.documentElement.classList.contains("weather-split");
  document.documentElement.classList.toggle("weather-split", splitWeather);
  if (splitWeather !== wasSplitWeather || oldDisplayMode !== normalized.weather.display || oldWeatherEnabled !== normalized.weather.enabled) {
    const resetWeatherScroll = () => { elements["weather-panel"].scrollTop = 0; };
    resetWeatherScroll();
    requestAnimationFrame(resetWeatherScroll);
  }
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
  renderStreamHealth();
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

function renderStreamHealth() {
  let level = "checking", title = "Checking connection", detail = "Contacting stream server";
  let videoLabel = "Video waiting";
  if (state.streamServerReachable === false) {
    level = state.streamStatusReason === "media-server-disabled" ? "offline" : "offline";
    title = state.streamStatusReason === "media-server-disabled" ? "Stream server disabled" : "Stream server unreachable";
    detail = "Check the AEROLINK launcher and network";
    videoLabel = "Gateway offline";
  } else if (state.streamServerReachable === true && !state.videoLive) {
    level = state.videoEverLive ? "reconnecting" : "waiting";
    title = state.videoEverLive ? "Reconnecting" : "Server ready";
    detail = state.videoEverLive ? "Waiting for the camera stream" : "Waiting for camera stream";
    videoLabel = state.videoEverLive ? "Video reconnecting" : "Video waiting";
  } else if (state.videoLive) {
    const dataWasObserved = state.lastStreamDataAt !== null;
    const referenceTime = state.lastStreamDataAt ?? state.streamObservedAt;
    const seconds = referenceTime === null ? null : Math.max(0, Math.floor((Date.now() - referenceTime) / 1000));
    const stalled = seconds !== null && seconds > 10;
    level = stalled ? "stalled" : "live";
    title = stalled ? "Stream may be stalled" : "Stream connected";
    detail = seconds === null ? "Publisher active · traffic timing unavailable" : stalled ? `No new data observed · ${seconds}s` : dataWasObserved ? `Publisher data seen · ${seconds < 1 ? "now" : `${seconds}s ago`}` : "Publisher active · checking for new data";
    videoLabel = stalled ? "Video stalled" : "Video live";
  }
  elements["stream-health"].dataset.state = level;
  elements["stream-health-label"].textContent = title;
  elements["stream-health-detail"].textContent = detail;
  setStatus(elements["video-status"], level === "live" ? "live" : level === "stalled" || level === "reconnecting" ? "stale" : "idle", videoLabel);
  if (elements["live-badge-label"]) elements["live-badge-label"].textContent = level === "stalled" ? "STALLED" : level === "reconnecting" ? "RECONNECTING" : "LIVE";
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
    if (!response.ok) throw new Error("Stream status unavailable");
    const status = await response.json();
    const wasLive = state.videoLive;
    state.streamServerReachable = status.serverReachable === true;
    state.streamStatusReason = status.reason ?? null;
    if (Number.isFinite(status.bytesReceived)) {
      if (state.streamObservedAt === null) state.streamObservedAt = Date.now();
      if (state.streamBytesReceived !== null && status.bytesReceived !== state.streamBytesReceived) state.lastStreamDataAt = Date.now();
      state.streamBytesReceived = status.bytesReceived;
    } else if (status.live && state.lastStreamDataAt === null) {
      state.lastStreamDataAt = Date.now();
    }
    state.videoLive = status.live === true;
    if (state.videoLive) state.videoEverLive = true;
    document.body.classList.toggle("video-live", state.videoLive);
    elements["video-placeholder"].classList.toggle("hidden", state.videoLive);
    elements["live-badge"].classList.toggle("visible", state.videoLive);
    if (state.videoLive && !wasLive) reloadVideo();
    renderStreamHealth();
    updateSetupGuideStatus();
  } catch {
    state.videoLive = false;
    state.streamServerReachable = false;
    state.streamStatusReason = "media-server-unavailable";
    document.body.classList.remove("video-live");
    elements["video-placeholder"].classList.remove("hidden");
    elements["live-badge"].classList.remove("visible");
    renderStreamHealth();
    updateSetupGuideStatus();
  }
}

function updateSetupGuideStatus() {
  if (!elements["setup-guide-status"]) return;
  if (state.videoLive) elements["setup-guide-status"].textContent = "Camera stream detected. The viewer should be showing it now.";
  else if (state.streamServerReachable === false) elements["setup-guide-status"].textContent = "Stream server unavailable. Check that the AEROLINK launcher is running.";
  else if (state.videoEverLive) elements["setup-guide-status"].textContent = "Stream interrupted. Check DJI Fly and the selected feed key.";
  else elements["setup-guide-status"].textContent = "Waiting for camera stream. Check DJI Fly is streaming to this feed key.";
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
  form.elements.namedItem("displayMode").value = normalized.displayMode;
  form.elements.namedItem("weatherEnabled").checked = normalized.weather.enabled;
  form.elements.namedItem("weatherDisplay").value = normalized.weather.display;
  form.elements.namedItem("weatherLatitude").value = normalized.weather.latitude ?? "";
  form.elements.namedItem("weatherLongitude").value = normalized.weather.longitude ?? "";
  form.elements.namedItem("pilotLimitMps").value = normalized.weather.pilotLimitMps ?? "";
  form.elements.namedItem("weatherAlertsEnabled").checked = normalized.weather.alerts.enabled;
  form.elements.namedItem("weatherAlertWindMps").value = normalized.weather.alerts.windMps ?? "";
  form.elements.namedItem("weatherAlertGustMps").value = normalized.weather.alerts.gustMps ?? "";
  form.elements.namedItem("weatherAlertRainPct").value = normalized.weather.alerts.rainProbabilityPct ?? "";
  form.elements.namedItem("weatherAlertVisibilityKm").value = normalized.weather.alerts.minimumVisibilityKm ?? "";
  updateWeatherAlertInputs();
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
  const cleanUrl = new URL("/output", window.location.origin);
  cleanUrl.searchParams.set("stream", settingsStreamKey());
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
  viewerUrl.pathname = "/";
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
    displayMode: form.elements.namedItem("displayMode").value,
    overlayLayout: state.savedPreferences.overlayLayout,
    weather: {
      enabled: form.elements.namedItem("weatherEnabled").checked,
      display: form.elements.namedItem("weatherDisplay").value,
      latitude: form.elements.namedItem("weatherLatitude").value,
      longitude: form.elements.namedItem("weatherLongitude").value,
      pilotLimitMps: form.elements.namedItem("pilotLimitMps").value,
      alerts: {
        enabled: form.elements.namedItem("weatherAlertsEnabled").checked,
        windMps: form.elements.namedItem("weatherAlertWindMps").value,
        gustMps: form.elements.namedItem("weatherAlertGustMps").value,
        rainProbabilityPct: form.elements.namedItem("weatherAlertRainPct").value,
        minimumVisibilityKm: form.elements.namedItem("weatherAlertVisibilityKm").value,
      },
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
const locationMap = createLocationMap({
  element: elements["weather-map"], tiles: elements["weather-map-tiles"],
  onSelect: ({ latitude, longitude }) => {
    const form = elements["settings-form"];
    form.elements.namedItem("weatherLatitude").value = latitude.toFixed(6);
    form.elements.namedItem("weatherLongitude").value = longitude.toFixed(6);
    elements["weather-settings-result"].textContent = "Map location selected and saved.";
    scheduleSettingsSave();
  },
});
const briefingLocationMap = createLocationMap({
  element: elements["briefing-map"],
  tiles: elements["briefing-map-tiles"],
  interactive: false,
  initialZoom: 11,
});
function syncLocationMap() {
  const form = elements["settings-form"];
  const latitude = Number(form.elements.namedItem("weatherLatitude").value);
  const longitude = Number(form.elements.namedItem("weatherLongitude").value);
  if (form.elements.namedItem("weatherLatitude").value !== "" && form.elements.namedItem("weatherLongitude").value !== "") locationMap.setCenter(latitude, longitude);
}
elements["weather-map-details"].addEventListener("toggle", () => { if (elements["weather-map-details"].open) { syncLocationMap(); locationMap.open(); } });
elements["weather-map-zoom-in"].addEventListener("click", () => locationMap.setZoom(1));
elements["weather-map-zoom-out"].addEventListener("click", () => locationMap.setZoom(-1));
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
        locationMap.setCenter(place.latitude, place.longitude);
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
    locationMap.setCenter(position.coords.latitude, position.coords.longitude);
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
  if (event.target.name === "weatherDisplay" && event.target.value === "split") {
    elements["settings-form"].elements.namedItem("weatherEnabled").checked = true;
  }
  if (event.target.name === "rawOutput") updateCleanOutputLink(event.target.checked);
  if (event.target.name === "weatherAlertsEnabled") updateWeatherAlertInputs();
  if (event.target.id === "settings-stream-key") { updateConnectionLinks(); return; }
  if (event.target.id === "weather-place-query") return;
  scheduleSettingsSave();
});
elements["settings-form"].addEventListener("input", (event) => {
  if (event.target.id === "settings-stream-key") { updateConnectionLinks(); return; }
  if (event.target.id === "weather-place-query") return;
  scheduleSettingsSave(event.target.type === "text" || event.target.type === "number" ? 250 : 0);
});
elements["setup-check"]?.addEventListener("click", async () => {
  elements["setup-guide-status"].textContent = "Checking the stream server…";
  await refreshStreamStatus();
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
