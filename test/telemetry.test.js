import test from "node:test";
import assert from "node:assert/strict";

import {
  distanceAndBearing,
  normalizeTelemetry,
  TelemetryValidationError,
} from "../src/telemetry.js";

test("normalizeTelemetry accepts a complete Remote ID observation", () => {
  const telemetry = normalizeTelemetry({
    timestamp: "2026-10-25T08:30:00.000Z",
    source: "remote-id",
    uasId: "1581F-test",
    operatorId: "MUS-test",
    latitude: -20.1612,
    longitude: 57.4989,
    heightM: 42.5,
    groundSpeedMps: 8.2,
    courseDeg: 494,
    homeLatitude: -20.162,
    homeLongitude: 57.4977,
    rssiDbm: -58,
  });

  assert.equal(telemetry.timestamp, "2026-10-25T08:30:00.000Z");
  assert.equal(telemetry.source, "remote-id");
  assert.equal(telemetry.courseDeg, 134);
  assert.equal(telemetry.heightM, 42.5);
  assert.equal(telemetry.rssiDbm, -58);
});

test("normalizeTelemetry defaults optional values and timestamp", () => {
  const telemetry = normalizeTelemetry({ latitude: 0, longitude: 0 });

  assert.equal(telemetry.source, "remote-id");
  assert.equal(telemetry.heightM, null);
  assert.equal(telemetry.uasId, null);
  assert.ok(Number.isFinite(Date.parse(telemetry.timestamp)));
});

test("normalizeTelemetry rejects invalid coordinates", () => {
  assert.throws(
    () => normalizeTelemetry({ latitude: 91, longitude: 0 }),
    TelemetryValidationError,
  );
  assert.throws(
    () => normalizeTelemetry({ latitude: 0, longitude: -181 }),
    TelemetryValidationError,
  );
});

test("normalizeTelemetry rejects an invalid timestamp and oversized identifier", () => {
  assert.throws(
    () => normalizeTelemetry({ latitude: 0, longitude: 0, timestamp: "later" }),
    TelemetryValidationError,
  );
  assert.throws(
    () => normalizeTelemetry({ latitude: 0, longitude: 0, uasId: "x".repeat(129) }),
    TelemetryValidationError,
  );
});

test("distanceAndBearing returns useful home-relative values", () => {
  const result = distanceAndBearing(-20.162, 57.4977, -20.1612, 57.4989);

  assert.ok(result.distanceM > 140 && result.distanceM < 170);
  assert.ok(result.bearingDeg > 45 && result.bearingDeg < 60);
});

