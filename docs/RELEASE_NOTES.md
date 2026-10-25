# AEROLINK 0.2.0

Windows portable distribution: extract the complete ZIP, then open AEROLINK.exe.
Keep the launcher open during use; closing it stops the services it started.
No separate Node.js or Docker installation is required.

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
