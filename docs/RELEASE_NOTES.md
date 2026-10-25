# AEROLINK 0.3.0

Windows portable distribution: extract the complete ZIP, then open AEROLINK.exe.
Keep the launcher open during use; closing it stops the services it started.
No separate Node.js or Docker installation is required.

- Optional flight weather overlay with modelled wind, gusts and conditions for
  chosen coordinates, independent of telemetry.
- Twelve DJI model profiles, with DJI-published wind ratings for eleven models.
  The Lito X1 rating remains unverified and is treated conservatively.
- Advisory states use precipitation, fog, storms, gusts, data freshness and an
  optional pilot wind limit. The display always warns that wind can change.
- Device location can be requested explicitly where supported; manual
  coordinates are always available.

Weather is an approximate model estimate, not an on-site or altitude-specific
measurement or a clearance to fly. Internet access is required. Open-Meteo's
public API is for noncommercial use; commercial use needs appropriate rights.

- Separate RTMP server link, stream key and complete address.
- Settings contain the telemetry demo and clean-output link actions.
- Each stream has its own demo and receiver observation state.
- Large media requests use HTTP byte ranges and streamed responses.
- Missing telemetry stays unknown rather than displaying a zero value.
- The live header reappears for pointer and keyboard interaction.

Remote ID hardware reception is in development. A decoded JSON receiver API
exists, but a radio receiver bridge and flight testing are still required.
Entering an ID does not connect to an aircraft or retrieve telemetry.

The Windows executable is unsigned. Hardware validation and signing remain
release follow-ups. This distribution is intended for a trusted local network.
