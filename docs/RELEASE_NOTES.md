# AEROLINK 0.6.0

- DJI-focused setup guidance and a branded Windows launcher icon and masthead.
- The launcher opens `http://localhost:3000` on the laptop for browser device location.
  Tablets use the LAN address, with place search and a map picker available.
- A dedicated `/output?stream=<key>` browser-source page keeps the waiting picture
  and shows the live WebRTC video without controls. Verified with an RTMP test feed.
- Flight weather now includes modelled wind at 80 and 120 m, rain probability,
  and visibility. Missing forecast fields produce caution; choose a compact overlay
  or a side-by-side briefing. Weather remains advisory and refreshes every five minutes.
- USB connection to a DJI RC 2 does not currently supply live telemetry to AEROLINK.
  The telemetry overlay still requires an external decoded receiver bridge.

## Previous release: 0.5.1

Windows portable distribution: extract the complete ZIP, then open AEROLINK.exe.
Keep the launcher open during use; closing it stops the services it started.
No separate Node.js or Docker installation is required.

- New feeds begin with no drone model or location selected, and neutral camera
  and controller guidance. Other aircraft can use a pilot-set wind limit.
- Weather, telemetry and flight-track overlays can each be dragged and resized.
  Their positions save for each feed and adapt to smaller screens.
- Settings save while you edit; Close simply dismisses the panel. A reset action
  restores default overlay positions.
- The stream key being prepared is retained when Settings is closed.
- Profiles saved by older versions with the old Lito X1 preset migrate to the
  neutral default once. Deliberate choices made in this version remain saved.

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
