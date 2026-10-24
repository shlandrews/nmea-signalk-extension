# Development tests

**Normal installation requires none of these tools or commands.** Load `chromium-extension/` directly in Chrome. All files required for operation are already present. Node.js and the dependencies below are only for contributors running tests or producing ZIP archives.

## Unit tests

With a current Node.js release:

```sh
node --test tests/*.test.mjs tests/*.test.cjs
```

No packages are needed for the 34 unit tests. They cover all four PGNs; fast-packet interleaving, loss, timeout and restart; passive BAM/RTS; source filtering/failover/cache clearing; NA fields, invalid quality and magnetic course; Actisense escaping/checksum/resync; SeaSmart and RAW records; NMEA 0183 talkers, hemispheres, checksums, fragmentation, UTC rollover and units; Signal K context/source/quality/stale timestamps; model estimates/freshness; malformed messages; settings migration; direct socket subscriptions, reconnect, silent/stalled connections; Geolocation callbacks, watches, cancellation, maximumAge, timeout, permissions and fallback. The isolated relay is tested directly to ensure it never posts credentials or stored settings to a website.

`tests/traffic.mjs` contains simulated wire traffic shared by decoder and browser tests. It emits supported PGNs, frames and binary/checksummed records with live UTC timestamps and configurable invalid quality, receiver address and movement. It is test data, not an external GPS service required by the extension.

## Full browser integration

For contributors only, install the development dependencies from `package.json` using your package manager, then install Playwright's Chromium:

```sh
pnpm install
pnpm exec playwright install chromium
node tests/extension-smoke.cjs
```

The test creates local mock WebSocket endpoints and a fresh isolated browser profile, loads the actual unpacked extension, and verifies:

- Direct authenticated Signal K handshake and own-vessel subscriptions.
- Live site geolocation updates with the popup closed; no server tokens, addresses or settings in page messages.
- Stale fixes, invalid quality and reconnection after disconnect.
- Actual service-worker termination while the offscreen GPS worker continues, and background recovery.
- Offscreen document recreation and reconnect from persisted settings.
- Direct NMEA 0183 text, NMEA 2000 SeaSmart/RAW text and Actisense binary WebSocket payloads.
- All four PGNs, source address/status, per-site native behavior, standalone popup controls and watch cancellation.

On Windows where Playwright's downloaded browser fails to launch, set `CHROMIUM_PATH` to a recent installed Chrome executable. The test uses the experimental DevTools `Extensions.loadUnpacked` API in the **isolated test profile**, with extension debugging enabled. It does not change your normal browser profile. The app never uses debugger permissions or these developer flags in ordinary installation.

## Packaging

```sh
node scripts/package.mjs
```

Produces `dist/marine-gps-extension.zip` (only the static standalone extension) and `dist/marine-gps-source.zip` (extension, tests, developer packaging and documentation). No Python, services, runtime npm packages or intermediary server are included. No build is required to load the extension directory.

Windows Chrome integration and JavaScript tests are exercised in this workspace. Linux/macOS, Raspberry Pi ARM64, physical gateways and different server security policies require platform/hardware acceptance testing. Payload parser support does not establish native WebSocket support for a gateway model. See [INSTALL.md](INSTALL.md) and [ARCHITECTURE.md](ARCHITECTURE.md) for these limits.
