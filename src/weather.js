const fields = "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day";
export function parseCoordinates(latitude, longitude) {
  if (latitude === null || longitude === null || String(latitude).trim() === "" || String(longitude).trim() === "") throw new Error("Enter latitude and longitude.");
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error("Coordinates must be latitude -90 to 90 and longitude -180 to 180.");
  return { latitude: lat, longitude: lon };
}
export function normalizeWeather(body, coordinates, now = Date.now()) {
  const current = body?.current;
  const units = body?.current_units;
  if (!current || units?.wind_speed_10m !== "m/s" || units?.wind_gusts_10m !== "m/s" || units?.precipitation !== "mm" || units?.temperature_2m !== "°C") throw new Error("Invalid weather response units.");
  const number = (key, min, max) => {
    const value = current[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Incomplete weather response.");
    return value;
  };
  const time = number("time", 0, 4_000_000_000) * 1000;
  if (time > now + 300_000 || now - time > 30 * 60_000) throw new Error("Weather data is out of date.");
  return {
    ...coordinates,
    gridLatitude: typeof body.latitude === "number" ? body.latitude : null,
    gridLongitude: typeof body.longitude === "number" ? body.longitude : null,
    time: new Date(time).toISOString(), fetchedAt: new Date(now).toISOString(),
    windMps: number("wind_speed_10m", 0, 150), gustMps: number("wind_gusts_10m", 0, 150),
    directionDeg: number("wind_direction_10m", 0, 360), temperatureC: number("temperature_2m", -100, 70),
    precipitationMm: number("precipitation", 0, 1000), weatherCode: number("weather_code", 0, 99),
    isDay: current.is_day === 1 ? true : current.is_day === 0 ? false : null,
    provider: "Open-Meteo", sourceUrl: "https://open-meteo.com/",
  };
}
export function createWeatherService({ fetchWeather = fetch, now = Date.now, apiKey = process.env.OPEN_METEO_API_KEY } = {}) {
  const cache = new Map(), pending = new Map();
  return async (coordinates) => {
    const key = `${coordinates.latitude},${coordinates.longitude}`;
    const cached = cache.get(key);
    if (cached && now() - cached.savedAt < 300_000) return cached.data;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const url = new URL(apiKey ? "https://customer-api.open-meteo.com/v1/forecast" : "https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({ ...coordinates, current: fields, wind_speed_unit: "ms", temperature_unit: "celsius", precipitation_unit: "mm", timeformat: "unixtime", timezone: "GMT", forecast_days: "1", cell_selection: "nearest", ...(apiKey ? { apikey: apiKey } : {}) }).toString();
      const response = await fetchWeather(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Weather provider unavailable.");
      const data = normalizeWeather(await response.json(), coordinates, now());
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { data, savedAt: now() });
      return data;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}
