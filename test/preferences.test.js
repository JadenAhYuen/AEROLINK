import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PREFERENCES,
  convertTelemetry,
  loadPreferences,
  normalizePreferences,
  resolveIdentity,
  savePreferences,
} from "../public/preferences.js";

test("preference defaults favor the daylight appearance and metric flight data", () => {
  assert.deepEqual(DEFAULT_PREFERENCES, {
    theme: "light",
    accent: "blue",
    units: "metric",
    aircraftName: "Lito X1",
    uasId: "",
    operatorId: "",
    droneModel: "lito-x1",
    weather: { enabled: false, latitude: null, longitude: null, pilotLimitMps: null },
    panels: {
      track: false,
      overlay: false,
      identity: true,
      signal: true,
      rawOutput: false,
    },
  });
});

test("normalizePreferences accepts known choices and trims dashboard identity overrides", () => {
  assert.deepEqual(
    normalizePreferences({
      theme: "light",
      accent: "indigo",
      units: "aviation",
      aircraftName: "  Survey One  ",
      uasId: "  1581F-test  ",
      operatorId: "  MUS-OP-001  ",
      panels: { track: false, overlay: false, identity: true, signal: false, rawOutput: false },
    }),
    {
      theme: "light",
      accent: "indigo",
      units: "aviation",
      aircraftName: "Survey One",
      uasId: "1581F-test",
      operatorId: "MUS-OP-001",
      droneModel: "lito-x1",
      weather: { enabled: false, latitude: null, longitude: null, pilotLimitMps: null },
      panels: { track: false, overlay: false, identity: true, signal: false, rawOutput: false },
    },
  );
});

test("normalizePreferences rejects unknown enum values and limits free text", () => {
  const preferences = normalizePreferences({
    theme: "neon",
    accent: "chartreuse",
    units: "furlongs",
    aircraftName: "A".repeat(100),
    uasId: 27,
    operatorId: null,
    panels: { track: "false", overlay: "true", identity: false },
  });

  assert.equal(preferences.theme, "light");
  assert.equal(preferences.accent, "blue");
  assert.equal(preferences.units, "metric");
  assert.equal(preferences.aircraftName.length, 40);
  assert.equal(preferences.uasId, "");
  assert.equal(preferences.operatorId, "");
  assert.deepEqual(preferences.panels, { track: false, overlay: false, identity: false, signal: true, rawOutput: false });
});

test("dashboard ID overrides take precedence without changing received telemetry", () => {
  const telemetry = { uasId: "RADIO-UAS", operatorId: "RADIO-OP" };
  const preferences = normalizePreferences({ uasId: "DISPLAY-UAS", operatorId: "DISPLAY-OP" });

  assert.deepEqual(resolveIdentity(telemetry, preferences), {
    uasId: "DISPLAY-UAS",
    operatorId: "DISPLAY-OP",
    uasOverridden: true,
    operatorOverridden: true,
  });
  assert.deepEqual(telemetry, { uasId: "RADIO-UAS", operatorId: "RADIO-OP" });
});

test("dashboard identity falls back to received values and human-readable placeholders", () => {
  assert.deepEqual(resolveIdentity({ uasId: "RADIO-UAS" }, DEFAULT_PREFERENCES), {
    uasId: "RADIO-UAS",
    operatorId: "Not received",
    uasOverridden: false,
    operatorOverridden: false,
  });
});

test("convertTelemetry returns display-ready metric values", () => {
  assert.deepEqual(convertTelemetry({ heightM: 12.34, groundSpeedMps: 5.55, distanceM: 321 }, "metric"), {
    height: { value: 12.3, unit: "m" },
    speed: { value: 5.6, unit: "m/s" },
    distance: { value: 321, unit: "m" },
  });
});

test("convertTelemetry converts height, speed, and range to aviation units", () => {
  assert.deepEqual(convertTelemetry({ heightM: 100, groundSpeedMps: 10, distanceM: 1852 }, "aviation"), {
    height: { value: 328, unit: "ft" },
    speed: { value: 19.4, unit: "kt" },
    distance: { value: 1, unit: "NM" },
  });
});

test("missing telemetry remains unknown in both unit systems", () => {
  for (const units of ["metric", "aviation"]) {
    const display = convertTelemetry({ heightM: null, groundSpeedMps: null, distanceM: null }, units);
    assert.equal(display.height.value, null);
    assert.equal(display.speed.value, null);
    assert.equal(display.distance.value, null);
  }
});

test("preferences survive a storage round trip and malformed storage falls back safely", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  savePreferences(storage, { theme: "dark", panels: { track: false } });
  assert.equal(loadPreferences(storage).theme, "dark");
  assert.equal(loadPreferences(storage).panels.track, false);

  values.set("lito-dashboard-preferences", "not-json");
  assert.deepEqual(loadPreferences(storage), DEFAULT_PREFERENCES);
});
