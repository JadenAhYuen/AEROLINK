export class TelemetryValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TelemetryValidationError";
  }
}

function optionalNumber(value, name, minimum, maximum) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TelemetryValidationError(`${name} must be a finite number`);
  }
  if (value < minimum || value > maximum) {
    throw new TelemetryValidationError(
      `${name} must be between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function requiredNumber(value, name, minimum, maximum) {
  const parsed = optionalNumber(value, name, minimum, maximum);
  if (parsed === null) {
    throw new TelemetryValidationError(`${name} is required`);
  }
  return parsed;
}

function optionalIdentifier(value, name) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new TelemetryValidationError(`${name} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 128) {
    throw new TelemetryValidationError(`${name} cannot exceed 128 characters`);
  }
  return trimmed || null;
}

export function normalizeTelemetry(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TelemetryValidationError("telemetry must be a JSON object");
  }

  const timestamp = input.timestamp ?? now.toISOString();
  if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) {
    throw new TelemetryValidationError("timestamp must be a valid ISO date string");
  }

  const source = optionalIdentifier(input.source, "source") ?? "remote-id";
  const course = optionalNumber(input.courseDeg, "courseDeg", -36000, 36000);

  return {
    timestamp: new Date(timestamp).toISOString(),
    receivedAt: now.toISOString(),
    source,
    uasId: optionalIdentifier(input.uasId, "uasId"),
    operatorId: optionalIdentifier(input.operatorId, "operatorId"),
    latitude: requiredNumber(input.latitude, "latitude", -90, 90),
    longitude: requiredNumber(input.longitude, "longitude", -180, 180),
    heightM: optionalNumber(input.heightM, "heightM", -1000, 10000),
    groundSpeedMps: optionalNumber(
      input.groundSpeedMps,
      "groundSpeedMps",
      0,
      200,
    ),
    courseDeg: course === null ? null : ((course % 360) + 360) % 360,
    homeLatitude: optionalNumber(
      input.homeLatitude,
      "homeLatitude",
      -90,
      90,
    ),
    homeLongitude: optionalNumber(
      input.homeLongitude,
      "homeLongitude",
      -180,
      180,
    ),
    rssiDbm: optionalNumber(input.rssiDbm, "rssiDbm", -200, 20),
  };
}

export function distanceAndBearing(fromLat, fromLon, toLat, toLon) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const degrees = (value) => (value * 180) / Math.PI;
  const earthRadiusM = 6_371_000;
  const phi1 = radians(fromLat);
  const phi2 = radians(toLat);
  const deltaPhi = radians(toLat - fromLat);
  const deltaLambda = radians(toLon - fromLon);

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const distanceM = earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const bearingDeg = (degrees(Math.atan2(y, x)) + 360) % 360;

  return { distanceM, bearingDeg };
}

