import test from "node:test";
import assert from "node:assert/strict";
import { DRONE_PROFILES } from "../public/drone-profiles.js";
import { assessWeather } from "../public/weather.js";
import { normalizePreferences } from "../public/preferences.js";
import { createWeatherService, parseCoordinates } from "../src/weather.js";

const now = Date.now();
const sample = { time: new Date(now).toISOString(), windMps: 3, gustMps: 5, wind80Mps: 4, wind120Mps: 5, visibilityM: 20000, rainProbabilityPct: 10, precipitationMm: 0, weatherCode: 2, isDay: true };

test("profiles include at least ten DJI models with published ratings", () => {
  assert.ok(DRONE_PROFILES.length >= 10);
  assert.equal(DRONE_PROFILES.find(({ id }) => id === "lito-x1").maxWindMps, 10.7);
  assert.equal(DRONE_PROFILES.find(({ id }) => id === "neo").maxWindMps, 8);
});

test("weather assessment considers gusts, precipitation, low light, freshness and pilot cap", () => {
  assert.equal(assessWeather(sample, "mini-4-pro", null, now).level, "favourable");
  assert.equal(assessWeather({ ...sample, gustMps: 8 }, "mini-4-pro", null, now).level, "caution");
  assert.equal(assessWeather({ ...sample, wind120Mps: 11 }, "mini-4-pro", null, now).level, "no-go");
  assert.equal(assessWeather({ ...sample, visibilityM: 1800 }, "mini-4-pro", null, now).level, "caution");
  assert.equal(assessWeather({ ...sample, rainProbabilityPct: 75 }, "mini-4-pro", null, now).level, "caution");
  assert.equal(assessWeather({ ...sample, wind80Mps: null }, "mini-4-pro", null, now).level, "caution");
  assert.equal(assessWeather({ ...sample, gustMps: 11 }, "mini-4-pro", null, now).level, "no-go");
  assert.equal(assessWeather({ ...sample, precipitationMm: 0.1 }, "mini-4-pro", null, now).level, "no-go");
  assert.equal(assessWeather({ ...sample, weatherCode: 95 }, "mini-4-pro", null, now).level, "no-go");
  assert.equal(assessWeather({ ...sample, isDay: false }, "mini-4-pro", null, now).level, "caution");
  assert.equal(assessWeather({ ...sample, time: new Date(now - 31 * 60_000).toISOString() }, "mini-4-pro", null, now).level, "unknown");
  assert.equal(assessWeather(sample, "lito-x1", null, now).level, "favourable");
  assert.equal(assessWeather(sample, "none", null, now).level, "unknown");
  assert.equal(assessWeather(sample, "custom", 7, now).level, "caution");
  assert.equal(assessWeather({ ...sample, gustMps: 9 }, "lito-x1", 7, now).level, "no-go");
  assert.equal(assessWeather(sample, "neo", 4, now).level, "no-go");
  assert.equal(assessWeather(sample, "neo", 20, now).limitMps, 8);
});

test("weather settings validate coordinates and model", () => {
  assert.deepEqual(normalizePreferences({ droneModel: "neo", weather: { enabled: true, latitude: 0, longitude: 0, pilotLimitMps: 6 } }).weather,
    { enabled: true, display: "overlay", latitude: 0, longitude: 0, pilotLimitMps: 6 });
  assert.equal(normalizePreferences({ droneModel: "unknown", weather: { latitude: 100 } }).droneModel, "none");
  assert.equal(normalizePreferences({ weather: { latitude: 100 } }).weather.latitude, null);
  assert.throws(() => parseCoordinates("", "0"));
  assert.throws(() => parseCoordinates("91", "0"));
  assert.deepEqual(parseCoordinates("0", "0"), { latitude: 0, longitude: 0 });
});

test("weather service fixes provider, units, validates data and caches a location", async () => {
  let calls = 0;
  const service = createWeatherService({ now: () => now, fetchWeather: async (url) => {
    calls++;
    assert.equal(url.hostname, "api.open-meteo.com");
    assert.equal(url.searchParams.get("wind_speed_unit"), "ms");
    assert.match(url.searchParams.get("current"), /wind_speed_120m/);
    assert.equal(url.searchParams.get("hourly"), "precipitation_probability");
    assert.equal(url.searchParams.get("latitude"), "52.52");
    return { ok: true, json: async () => ({ latitude: 52.5, longitude: 13.4,
      current_units: { wind_speed_10m: "m/s", wind_speed_80m: "m/s", wind_speed_120m: "m/s", wind_gusts_10m: "m/s", visibility: "m", cloud_cover: "%", precipitation: "mm", temperature_2m: "°C" },
      current: { time: Math.floor(now / 1000), wind_speed_10m: 3, wind_speed_80m: 4, wind_speed_120m: 5, wind_gusts_10m: 5, visibility: 18000, cloud_cover: 20, wind_direction_10m: 180, temperature_2m: 18, precipitation: 0, weather_code: 2, is_day: 1 },
      hourly_units: { precipitation_probability: "%" },
      hourly: { time: [Math.floor(now / 1000) + 3600], precipitation_probability: [15] },
    }) };
  } });
  const coordinate = { latitude: 52.52, longitude: 13.41 };
  const [first, second] = await Promise.all([service(coordinate), service(coordinate)]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  await service(coordinate);
  assert.equal(calls, 1);
  assert.equal(first.gustMps, 5);
  assert.equal(first.wind120Mps, 5);
  assert.equal(first.visibilityM, 18000);
  assert.equal(first.rainProbabilityPct, 15);
});
