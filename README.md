# Marine GPS — standalone Chromium extension

Use your vessel's GPS in websites that call `navigator.geolocation`. **The entire application runs inside this Manifest V3 extension.** No Python bridge, local server, native messaging host, Node.js runtime, service or build step is required.

## Install and connect

1. Open `chrome://extensions` in Chrome or Chromium 116 or newer.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `chromium-extension` directory from this repository, or extract the extension ZIP and select its directory.
5. Open the extension popup and enter your Signal K server hostname/IP. The defaults are `ws`, port `3000`, path `/signalk/v1/stream`. Set port, path and `wss` if your server uses different values.
6. Check **On**, then **Save & connect**. Reload website tabs that were open before installation.

The popup displays connection state, GPS fix validity, latitude/longitude, speed in knots, true COG, estimated accuracy and position age. Close it: the offscreen document and its dedicated worker continue receiving data. A website's `getCurrentPosition`, `watchPosition` and `clearWatch` use the selected GPS source. The global switch and **Enable for [website]** control substitution; disabled sites use the browser's original geolocation API.

See [INSTALL.md](INSTALL.md) for platform and server settings, [ARCHITECTURE.md](ARCHITECTURE.md) for implementation/security details, and [TESTING.md](TESTING.md) for developer tests.

## Direct WebSocket sources

| Source | Data received by the extension |
| --- | --- |
| Signal K | Standard own-vessel JSON deltas via the native browser WebSocket API |
| NMEA 0183 over WebSocket | Text RMC, GGA, GLL and VTG sentences; checksums verified when supplied |
| NMEA 2000 over WebSocket | Select SeaSmart PCDIN text, Yacht Devices RAW text CAN frames, or Actisense NGT `0x93` binary payloads |

The server must already offer a **real WebSocket endpoint**, including its HTTP Upgrade handshake, at the configured address/port/path. The NMEA payload formats are documented in [ARCHITECTURE.md](ARCHITECTURE.md). Their parsers run entirely in the extension. They do not imply that every gateway serving those formats also offers WebSockets. Consult the gateway's documentation for both transport and payload format.

**Raw TCP, UDP and SocketCAN are not supported by standalone Chromium extensions.** Their old configuration options and Python implementations have been removed. A TCP or UDP port cannot be used by replacing its scheme with `ws://`. In particular, the YDEN-02's documented RAW TCP/UDP output is not a compatible WebSocket endpoint. For that hardware, an existing Signal K server or a gateway that natively exposes the required data over WebSocket is needed. This extension does not install or launch an intermediary.

## Signal K

The extension requests only its own vessel and subscribes to:

- `navigation.position`
- `navigation.speedOverGround`
- `navigation.courseOverGroundTrue`
- `navigation.datetime`
- `navigation.gnss.horizontalDilution`
- `navigation.gnss.methodQuality`
- `navigation.gnss.integrity`

Old cached deltas, invalid/out-of-range coordinates and invalid quality are rejected. SI speed remains m/s for the browser; true COG changes from radians to degrees. Missing optional values remain null. One position-producing Signal K source is selected at a time to avoid combining motion/quality from different receivers.

Authenticated servers: open **Authentication & accuracy**, select **Access token**, and enter a server-issued read token. It is attached to the Signal K WebSocket handshake as a `token` query parameter. It is stored locally in the extension profile and never sent to visited pages. Prefer `wss` on untrusted networks. Native browser WebSockets cannot set arbitrary `Authorization` headers; servers requiring header-only authentication must offer a browser-compatible method. No passwords or tokens are logged by the extension. The server and the browser's extension developer tools can see the authenticated handshake URL, so configure server/proxy logs accordingly.

## NMEA 2000

The JavaScript decoders support PGNs **129025** (rapid position), **129026** (true COG/SOG), **129029** (GNSS position and quality) and **126992** (system time). RAW CAN payloads go through bounded fast-packet and passive ISO BAM/RTS reassembly; Actisense and SeaSmart supply already assembled PGNs.

The popup shows selected and observed PGNs, source address, fix quality and last received update. Specify a source address or leave it blank for automatic selection. Automatic mode locks to one position-producing address and switches only after its position expires; switching clears cached motion and quality. Once 129029 is observed, rapid positions must inherit a valid, fresh GNSS quality. Rapid-only streams cannot establish fix method and show unknown quality. Magnetic COG is never reported as true course. The extension never transmits CAN messages or actively acknowledges ISO transport.

## Stale positions and accuracy

The default stale timeout is 10 seconds. Choose one behavior when GPS becomes unavailable:

- Report `POSITION_UNAVAILABLE`.
- Use the browser's original geolocation and its normal permission flow.
- Use the last **valid** position with its original timestamp; the popup shows the stale/error state.

HDOP is not accuracy in metres. When available, accuracy is estimated as HDOP × the configurable UERE; otherwise a configurable conservative 100 m estimate is used. The UI labels estimates and does not imply a calibrated confidence radius. No speed, course, altitude or altitude accuracy is invented.

## Platform and browser limits

Supports Chrome/Chromium on Windows, Linux, macOS and Raspberry Pi OS Bookworm ARM64, using browser-standard JavaScript and bundled static files. Linux ARM64/hardware interoperability still needs testing on the actual device; Windows Chrome is covered by automated integration.

Secure-context and Permissions Policy restrictions apply. Explicit browser geolocation denial is respected. Native fallback uses normal browser permissions; the substituted API does not display a native location prompt for a site whose permission is still `prompt`. Users authorize the extension's site access and override controls. This does not bypass operating-system or website security restrictions. Browser internal pages, workers belonging to websites, and browser-internal location consumers are outside the document-level override. File URLs are not intercepted. Cross-origin frames depend on extension site access and the embedding document's permissions policy.

Visited pages receive only normalized position results and per-document actions, not credentials, server addresses, extension settings, site lists or privileged extension messaging. A page can still inspect or rewrite its own JavaScript Geolocation API and spoof messages inside its own MAIN world; this architecture is not a security boundary against that same page. Such messages cannot reach the GPS socket or change stored settings.

The offscreen worker reconnects after network loss, discards silent sockets, and survives normal service-worker suspension. Startup, subscriptions and a health alarm recover a missing offscreen document. Chrome must remain running; browser/OS shutdown or sleep pauses GPS delivery and can delay alarm-based recovery. No extension can guarantee service while the browser is stopped.

License: MIT. There are **no runtime third-party packages** in the installed extension. All test/build dependencies are development-only.
