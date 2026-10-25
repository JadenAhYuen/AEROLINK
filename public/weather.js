import { droneProfile } from "./drone-profiles.js";

const codes = new Map([
  [0, "Clear sky"], [1, "Mainly clear"], [2, "Partly cloudy"], [3, "Overcast"],
  [45, "Fog"], [48, "Freezing fog"], [51, "Light drizzle"], [53, "Drizzle"], [55, "Dense drizzle"],
  [56, "Freezing drizzle"], [57, "Freezing drizzle"], [61, "Light rain"], [63, "Rain"], [65, "Heavy rain"],
  [66, "Freezing rain"], [67, "Freezing rain"], [71, "Light snow"], [73, "Snow"], [75, "Heavy snow"],
  [77, "Snow grains"], [80, "Rain showers"], [81, "Rain showers"], [82, "Heavy showers"],
  [85, "Snow showers"], [86, "Heavy snow showers"], [95, "Thunderstorm"], [96, "Thunderstorm with hail"], [99, "Thunderstorm with hail"],
]);
export const WEATHER_DISCLAIMER = "Approximate calculation only. Wind can change at any time and may be stronger at flight altitude. Check conditions on site; this is not a flight clearance.";
export function weatherDescription(code) { return codes.get(code) ?? "Unknown conditions"; }
export function assessWeather(weather, modelId, pilotLimitMps = null, now = Date.now()) {
  const unknown = (reason) => ({ level: "unknown", label: "No assessment", reason });
  if (!weather) return unknown("Choose coordinates in Settings and check the weather.");
  const age = now - Date.parse(weather.time);
  if (!Number.isFinite(age) || age < -300_000 || age > 30 * 60_000) return unknown("Weather is out of date. Refresh before making a decision.");
  if (![weather.windMps, weather.gustMps, weather.precipitationMm].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0) || !codes.has(weather.weatherCode)) {
    return unknown("Required weather data is missing or invalid.");
  }
  if (weather.weatherCode >= 95) return { level: "no-go", label: "Do not fly · Weather", reason: "Thunderstorm or hail indicated near this location." };
  if ([45, 48].includes(weather.weatherCode)) return { level: "no-go", label: "Do not fly · Weather", reason: "Fog indicated. Visibility and moisture are concerns." };
  if (weather.precipitationMm > 0 || weather.weatherCode >= 51) return { level: "no-go", label: "Do not fly · Weather", reason: "Rain, drizzle, snow or freezing precipitation indicated." };
  const profile = droneProfile(modelId);
  const pilot = typeof pilotLimitMps === "number" && Number.isFinite(pilotLimitMps) && pilotLimitMps > 0 ? pilotLimitMps : null;
  const limit = profile.maxWindMps === null ? pilot : Math.min(profile.maxWindMps, pilot ?? Infinity);
  if (limit === null) return unknown("Aircraft wind rating is unverified. Set a conservative pilot limit in Settings.");
  const peak = Math.max(weather.windMps, weather.gustMps);
  if (peak >= limit) return { level: "no-go", label: "Do not fly · Wind", reason: "Wind or gusts reach the selected wind limit.", limitMps: limit };
  if (peak >= limit * 0.7) return { level: "caution", label: "Caution · Wind", reason: "Wind or gusts are within 30% of the selected limit.", limitMps: limit };
  if (profile.maxWindMps === null) return { level: "caution", label: "Caution · Pilot limit", reason: "Below your pilot limit, but the aircraft rating is unverified.", limitMps: limit };
  if (weather.isDay !== true) return { level: "caution", label: "Caution · Low light", reason: "Night or daylight information unavailable. Check visibility and aircraft requirements.", limitMps: limit };
  return { level: "favourable", label: "Favourable · Estimate", reason: "Dry conditions; modelled wind and gusts are below 70% of the selected limit. Other flight risks are not assessed.", limitMps: limit };
}
