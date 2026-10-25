# Release review — 25 October 2026

## Addressed

- Moved simulated telemetry to Settings and labeled receiver support in development.
- Isolated simulator start/stop and observations per stream.
- Corrected unknown readings in aviation units.
- Corrected the separate server/key connection instructions and regenerated links.
- Kept the normal viewer available when producing a clean browser-source URL.
- Added streaming file reads, range requests and encoded-filename handling.
- Restored waiting state and header access when the gateway goes offline.
- Added a portable launcher, owned-process cleanup, startup diagnostics and release CI.
- Excluded locally supplied media and runtime files from Git and release archives.

## Still requires validation or configuration

- Real aircraft and RC 2 flight test: RTMP publishing, tablet playback, end-to-end latency.
- Remote ID receiver bridge and radio/hardware verification.
- Windows signing certificate and signed distribution process.
- Public hosting requires a selected host and authentication/TLS configuration;
  the included deployment is a local flight-network application.
- GitHub Actions builds and publishes the Windows download from the connected repository.

Automated checks establish API behavior and packaging; they do not establish
aircraft hardware compatibility or a completed live-flight test.
