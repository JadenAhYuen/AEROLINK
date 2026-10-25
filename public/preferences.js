const STORAGE_KEY = "lito-dashboard-preferences";

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: "light",
  accent: "blue",
  units: "metric",
  aircraftName: "Lito X1",
  uasId: "",
  operatorId: "",
  panels: Object.freeze({
    track: false,
    overlay: false,
    identity: true,
    signal: true,
    rawOutput: false,
  }),
});

const choices = {
  theme: new Set(["system", "light", "dark"]),
  accent: new Set(["blue", "indigo", "mint", "orange"]),
  units: new Set(["metric", "aviation"]),
};

function choice(value, group, fallback) {
  return typeof value === "string" && choices[group].has(value) ? value : fallback;
}

function cleanText(value, fallback, maximumLength) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(0, maximumLength) || fallback;
}

function panelChoice(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizePreferences(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const panels = source.panels && typeof source.panels === "object" ? source.panels : {};

  return {
    theme: choice(source.theme, "theme", DEFAULT_PREFERENCES.theme),
    accent: choice(source.accent, "accent", DEFAULT_PREFERENCES.accent),
    units: choice(source.units, "units", DEFAULT_PREFERENCES.units),
    aircraftName: cleanText(source.aircraftName, DEFAULT_PREFERENCES.aircraftName, 40),
    uasId: cleanText(source.uasId, "", 64),
    operatorId: cleanText(source.operatorId, "", 64),
    panels: {
      track: panelChoice(panels.track, DEFAULT_PREFERENCES.panels.track),
      overlay: panelChoice(panels.overlay, DEFAULT_PREFERENCES.panels.overlay),
      identity: panelChoice(panels.identity, DEFAULT_PREFERENCES.panels.identity),
      signal: panelChoice(panels.signal, DEFAULT_PREFERENCES.panels.signal),
      rawOutput: panelChoice(panels.rawOutput, DEFAULT_PREFERENCES.panels.rawOutput),
    },
  };
}

export function loadPreferences(storage, storageKey = STORAGE_KEY) {
  try {
    const saved = storage?.getItem(storageKey);
    return saved ? normalizePreferences(JSON.parse(saved)) : normalizePreferences();
  } catch {
    return normalizePreferences();
  }
}

export function savePreferences(storage, preferences, storageKey = STORAGE_KEY) {
  const normalized = normalizePreferences(preferences);
  storage?.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
}

export function resolveIdentity(telemetry = {}, preferences = DEFAULT_PREFERENCES) {
  const normalized = normalizePreferences(preferences);
  return {
    uasId: normalized.uasId || telemetry.uasId || "Not received",
    operatorId: normalized.operatorId || telemetry.operatorId || "Not received",
    uasOverridden: Boolean(normalized.uasId),
    operatorOverridden: Boolean(normalized.operatorId),
  };
}

function rounded(value, digits) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function scaled(value, factor) {
  return typeof value === "number" && Number.isFinite(value) ? value * factor : null;
}

export function convertTelemetry({ heightM, groundSpeedMps, distanceM } = {}, units = "metric") {
  if (units === "aviation") {
    return {
      height: { value: rounded(scaled(heightM, 3.28084), 0), unit: "ft" },
      speed: { value: rounded(scaled(groundSpeedMps, 1.94384), 1), unit: "kt" },
      distance: { value: rounded(scaled(distanceM, 1 / 1852), 2), unit: "NM" },
    };
  }

  return {
    height: { value: rounded(heightM, 1), unit: "m" },
    speed: { value: rounded(groundSpeedMps, 1), unit: "m/s" },
    distance: { value: rounded(distanceM, 0), unit: "m" },
  };
}
