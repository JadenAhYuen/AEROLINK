# Connecting a real Remote ID receiver

**Status: in development.** The HTTP ingestion/display contract is implemented
and tested with generated observations. No radio receiver bridge is bundled,
and real aircraft reception has not been validated. Entering a UAS ID or operator
ID in Settings changes labels only; it does not connect a receiver.

The dashboard cannot receive Wi-Fi Beacon frames through a normal browser.
Those frames must first be decoded by a compatible Android device, ESP32, or
Wi-Fi adapter. The receiver then sends normalized observations to the laptop.

## Dashboard endpoint

Send an HTTP `POST` with `Content-Type: application/json` to:

```text
http://<laptop-ip>:3000/api/telemetry?stream=<stream-key>
```

Only `latitude` and `longitude` are mandatory. The complete accepted message is:

```json
{
  "timestamp": "2026-10-25T08:30:00.000Z",
  "source": "remote-id",
  "uasId": "aircraft serial or session ID",
  "operatorId": "operator registration ID",
  "latitude": -20.1612,
  "longitude": 57.4989,
  "heightM": 42.5,
  "groundSpeedMps": 8.2,
  "courseDeg": 134,
  "homeLatitude": -20.162,
  "homeLongitude": 57.4977,
  "rssiDbm": -58
}
```

Unknown values should be omitted or sent as `null`. Never substitute zero for
an unknown height, speed, home position, or signal strength.

On a shared network, start the dashboard with a receiver token:

```powershell
.\start.ps1 -TelemetryToken "choose-a-long-random-value"
```

The receiver must then include `Authorization: Bearer <token>` with every
telemetry request. The token is optional on a dedicated, trusted flight network.

## Receiver choices

### DJI RC 2 USB

The RC 2 USB-C connection supports connection to a computer for file transfer,
but DJI does not document a live telemetry stream or Windows API over this port.
DJI also says third-party apps cannot be installed on RC 2. AEROLINK therefore
does not read flight telemetry by plugging the controller into the laptop.
This conclusion is based on DJI's public documentation and has not been tested
against a physical controller. See [DJI RC 2 support](https://www.dji.com/support/product/rc-2)
and [DJI's media export guide](https://repair.dji.com/help/content?customId=en-us03400006852&documentType=artical&lang=en&paperDocType=paper&re=US&spaceId=34).

### Android

The [OpenDroneID Receiver reference application](https://github.com/opendroneid/receiver-android)
supports Bluetooth, Wi-Fi NAN and Wi-Fi Beacon, depending on phone hardware.
Whether your aircraft broadcasts a compatible signal needs a hardware test.
Sending its decoded observations to this
dashboard requires a small Android bridge or an adaptation of that open-source
receiver. The dashboard contract above is intentionally independent of the
Android implementation.

### ESP32

An ESP32 in Wi-Fi monitor mode can decode OpenDroneID Wi-Fi Beacon messages and
POST each location observation over the local network. This is usually the most
compact permanent receiver for the dashboard.

## Manual receiver test

From PowerShell on the laptop:

```powershell
$sample = @{
  source = "remote-id"
  uasId = "DJI-TEST"
  latitude = -20.1612
  longitude = 57.4989
  heightM = 25.4
  groundSpeedMps = 6.1
  courseDeg = 120
  homeLatitude = -20.1620
  homeLongitude = 57.4977
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/telemetry" `
  -ContentType "application/json" `
  -Body $sample
```

The observation should appear immediately in dashboards for the matching stream.
The manual example uses the default `x` stream; add `?stream=<stream-key>` to test another.

## Network safety

The telemetry endpoint has no login because it is intended for a dedicated,
trusted local flight network. Do not port-forward ports 1935, 3000, 8189, or
8889 to the internet. A future public or shared-network deployment should add
receiver authentication and RTMP publishing credentials.
