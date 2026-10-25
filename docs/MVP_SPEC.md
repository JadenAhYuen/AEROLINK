# AEROLINK MVP

## Goal

Provide a local, secondary monitoring display for compatible RTMP publishers.
The display combines the camera stream with optional receiver telemetry in one
laptop- and tablet-friendly dashboard.

## Locked decisions

- The manually entered stream URL is `rtmp://<laptop-ip>/x`.
- MediaMTX receives RTMP on the standard port and serves WebRTC on port 8889.
- The dashboard is served on port 3000.
- Remote ID is normalized to JSON and submitted to the dashboard backend.
- Server-Sent Events update every connected dashboard without polling.
- The first release includes a simulator because physical Remote ID reception
  requires a compatible Android device or ESP32 receiver.
- The dashboard is a secondary monitor and must not be used as the primary
  flight display.

## Operator questions

The dashboard must make these answers immediately visible:

1. Is the video stream live?
2. Is Remote ID data arriving, and how old is it?
3. Where is the aircraft relative to the takeoff point?
4. What are its height, ground speed, course, and distance from home?
5. Which UAS and operator identifiers are being received?

## Telemetry contract

`POST /api/telemetry` accepts JSON with these normalized fields:

```json
{
  "timestamp": "2026-10-25T08:30:00.000Z",
  "source": "remote-id",
  "uasId": "1581F...",
  "operatorId": "OP-EXAMPLE",
  "latitude": 52.52,
  "longitude": 13.405,
  "heightM": 42.5,
  "groundSpeedMps": 8.2,
  "courseDeg": 134,
  "homeLatitude": 52.519,
  "homeLongitude": 13.404,
  "rssiDbm": -58
}
```

Only location and timestamp are required. Missing unavailable fields remain
`null`; the dashboard must never invent DJI-only telemetry such as battery or
radio-link quality.

## Acceptance criteria

- `docker compose up --build` starts the dashboard and media gateway.
- The dashboard displays its short RTMP URL using the host used to open it.
- A simulated flight updates all dashboard panels and the relative track.
- Valid external telemetry appears in every open dashboard within one second.
- Invalid coordinates or malformed JSON receive a 400 response.
- Data older than five seconds is visibly marked stale.
- Layout remains usable at 768px tablet width.

