# AEROLINK 0.7.0

- A compact hourly flight-weather timeline shows past conditions and the next 12 hours without horizontal scrolling.
- A **Best time to fly** summary highlights the longest upcoming favourable window for the selected DJI aircraft profile, or explains when no favourable window appears.
- Wind, gust, rain and visibility can trigger pilot-configured in-app forecast alerts.
- Simple and Detailed display modes help pilots choose between a minimal live view and a fuller weather briefing.
- The Detailed briefing includes the selected launch point on a map, wind direction, forecast age and a step-by-step first-stream guide in Settings.
- Stream health shows server reachability, publisher activity and a stalled feed when incoming publisher data stops.
- Switching between weather overlay and side-by-side resets stale scroll position and animates the panel into its new layout.
- Weather assessments remain approximate model estimates, not flight clearance. Wind and local conditions can change at any time.

## Previous release: 0.6.0

- DJI-focused setup guidance and a branded Windows launcher icon and masthead.
- The launcher opens `http://localhost:3000` on the laptop for browser device location. Tablets use the LAN address, with place search and a map picker available.
- A dedicated `/output?stream=<key>` browser-source page keeps the waiting picture and shows live WebRTC video without controls.
- Flight weather includes modelled wind at 80 and 120 m, rain probability and visibility. Weather remains advisory and refreshes every five minutes.
- USB connection to a DJI RC 2 does not currently supply live telemetry to AEROLINK. The telemetry overlay still requires an external decoded receiver bridge.

The Windows executable is unsigned. Hardware validation and signing remain release follow-ups. This distribution is intended for a trusted local network.
