const fields = "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_gusts_10m,wind_direction_10m,visibility,cloud_cover,is_day";
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
  const optional = (key, min, max, unit) => {
    const value = current[key];
    return units[key] === unit && typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
  };
  const hourlyValue = (index, key, min, max, unit) => {
    const value = body.hourly?.[key]?.[index];
    return body.hourly_units?.[key] === unit && typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
  };
  const hourlyTimes = Array.isArray(body.hourly?.time) ? body.hourly.time : [];
  const hourly = hourlyTimes.map((time, index) => ({
    time: Number.isFinite(time) ? new Date(time * 1000).toISOString() : null,
    temperatureC: hourlyValue(index, "temperature_2m", -100, 70, "°C"),
    rainProbabilityPct: hourlyValue(index, "precipitation_probability", 0, 100, "%"),
    weatherCode: hourlyValue(index, "weather_code", 0, 99, "wmo code"),
    cloudCoverPct: hourlyValue(index, "cloud_cover", 0, 100, "%"),
    windMps: hourlyValue(index, "wind_speed_10m", 0, 150, "m/s"),
    wind80Mps: hourlyValue(index, "wind_speed_80m", 0, 150, "m/s"),
    wind120Mps: hourlyValue(index, "wind_speed_120m", 0, 150, "m/s"),
    gustMps: hourlyValue(index, "wind_gusts_10m", 0, 150, "m/s"),
    directionDeg: hourlyValue(index, "wind_direction_10m", 0, 360, "°"),
    visibilityM: hourlyValue(index, "visibility", 0, 100000, "m"),
    isDay: body.hourly?.is_day?.[index] === 1 ? true : body.hourly?.is_day?.[index] === 0 ? false : null,
  })).filter((hour) => hour.time && Date.parse(hour.time) >= now - 3 * 3_600_000 && Date.parse(hour.time) <= now + 12 * 3_600_000);
  const nextDailyEvent = (key) => Array.isArray(body.daily?.[key])
    ? body.daily[key].filter(Number.isFinite).map((value) => value * 1000).filter((value) => value >= now).sort((a, b) => a - b)[0] ?? null
    : null;
  const time = number("time", 0, 4_000_000_000) * 1000;
  if (time > now + 300_000 || now - time > 30 * 60_000) throw new Error("Weather data is out of date.");
  return {
    ...coordinates,
    gridLatitude: typeof body.latitude === "number" ? body.latitude : null,
    gridLongitude: typeof body.longitude === "number" ? body.longitude : null,
    time: new Date(time).toISOString(), fetchedAt: new Date(now).toISOString(),
    windMps: number("wind_speed_10m", 0, 150), gustMps: number("wind_gusts_10m", 0, 150),
    wind80Mps: optional("wind_speed_80m", 0, 150, "m/s"),
    wind120Mps: optional("wind_speed_120m", 0, 150, "m/s"),
    visibilityM: optional("visibility", 0, 100000, "m"),
    cloudCoverPct: optional("cloud_cover", 0, 100, "%"),
    rainProbabilityPct: (() => {
      const index = body.hourly?.time?.findIndex((time) => time >= Math.floor(now / 1000));
      const probability = body.hourly?.precipitation_probability?.[index];
      return index >= 0 && body.hourly_units?.precipitation_probability === "%" && Number.isFinite(probability) && probability >= 0 && probability <= 100 ? probability : null;
    })(),
    hourly,
    nextSunrise: nextDailyEvent("sunrise") === null ? null : new Date(nextDailyEvent("sunrise")).toISOString(),
    nextSunset: nextDailyEvent("sunset") === null ? null : new Date(nextDailyEvent("sunset")).toISOString(),
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
      url.search = new URLSearchParams({ ...coordinates, current: fields, hourly: "temperature_2m,precipitation_probability,weather_code,cloud_cover,wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_gusts_10m,wind_direction_10m,visibility,is_day", daily: "sunrise,sunset,daylight_duration", past_hours: "3", forecast_hours: "12", wind_speed_unit: "ms", temperature_unit: "celsius", precipitation_unit: "mm", timeformat: "unixtime", timezone: "auto", forecast_days: "2", cell_selection: "nearest", ...(apiKey ? { apikey: apiKey } : {}) }).toString();
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
