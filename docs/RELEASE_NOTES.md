# AEROLINK 0.4.0

Windows portable distribution: extract the complete ZIP, then open AEROLINK.exe.
Keep the launcher open during use; closing it stops the services it started.
No separate Node.js or Docker installation is required.

- Compact flight weather overlay with wind, gusts, condition icon, status,
  update age and a graded scale against the selected drone's wind limit.
- Search for a place in Settings, use device location where supported, or
  enter coordinates. Weather refreshes every five minutes while enabled.
- The Lito X1 now uses DJI's published 10.7 m/s maximum wind resistance.
- Windows releases include seven verified waiting videos. Local builds include
  the videos present in the project's media folder.
- The launcher checks GitHub for updates and can download, verify and open a
  new version while keeping the old installation available.

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
