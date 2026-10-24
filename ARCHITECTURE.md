# Standalone architecture

```text
Existing Signal K / WebSocket-capable marine gateway
                        ↓ native WebSocket
offscreen document → dedicated JS worker
                        ↓ parser → shared GPS model
MV3 background worker ← sanitized normalized snapshots
                        ↓ isolated extension messages
content relay → per-document position/action → MAIN Geolocation API
```

There are no external application components. The extension loads directly from static files. `lib/connection.js` owns socket lifecycle and dispatch; `signalk.js`, `nmea0183.js` and `nmea2000.js` own parsing; `model.js` supplies the normalized model; `messages.js` validates extension boundary snapshots.

## Lifecycle

The service worker creates an offscreen document with the supported `WORKERS` reason. That document creates a dedicated module worker, which owns the native browser WebSocket, parsing, receiver selection and a 500 ms status heartbeat. Only `chrome.runtime` is used from the offscreen document; storage is handled by the background context. Closing the popup does not close the document or socket. Status messages wake the service worker if it has been suspended; it stores the latest snapshot in `chrome.storage.session` and distributes it to content scripts. Stored configuration uses `chrome.storage.local` with `TRUSTED_CONTEXTS` access, unavailable to content scripts.

Browser startup, extension installation, subscription requests and a one-minute health alarm ensure the offscreen document exists. A stale health reply triggers document recreation. A local watchdog restarts an unresponsive or crashed dedicated worker. Recreating a document/worker reads saved settings and reopens the source. Network retries use exponential backoff with jitter (about 1–30 seconds). A stalled handshake expires after 15 seconds; a silent open connection after at least 30 seconds or three stale intervals is replaced. Browser JavaScript cannot emit protocol-level WebSocket ping frames. Signals and NMEA position expiry remain independent of socket state. Browser shutdown/sleep can suspend everything; alarms are not hard real-time guarantees.

## Configuration and permissions

Version 2 settings explicitly choose `signalk`, `nmea0183` or `nmea2000`. Host, port, protocol and path form the WebSocket endpoint. No raw TCP, UDP or CAN options remain. Legacy settings are whitelisted into the new schema and bridge secrets are discarded. New configurations begin disabled. The Signal K stream requests `subscribe=none&sendCachedValues=false` and sends own-vessel subscriptions after opening. An optional access token is URL-encoded into the `token` query parameter; the browser API cannot set custom authentication headers.

Permissions are `storage` (local settings/session status), `offscreen` (persistent worker context), `alarms` (lifecycle recovery) and `activeTab` (the active website name for per-site controls after clicking the action). There is no `tabs`, `nativeMessaging`, `sockets`, debugger, geolocation, scripting, webRequest or blanket network host permission. Static HTTP/HTTPS content-script matches provide document-start interception on supported websites, subject to Chrome's extension site-access controls. WebSockets originate in the extension's worker; no remote code, eval, inline executable scripts or website-injected credentials are used.

## Security boundaries

Background handlers verify the sender extension ID. Full settings are sent only to the known offscreen document. Only that document may publish GPS state. Snapshots are validated for schema, status, types, coordinates, finite values and timestamps before distribution. Offscreen configuration/health requests accept only background-context senders. WebSocket data is bounded to 256 KiB per message; text buffers, binary packets and transport sessions have independent bounds. Invalid data never becomes executable code or raw diagnostics.

The isolated content relay receives only the operational policy and normalized state. It computes the active hostname's action and posts only a small coordinate result plus `gps`, `last`, `native`, `pending` or `unavailable` and a fix expiry to the MAIN world. It never posts settings, hostnames, tokens, source IDs, site-exclusion lists or diagnostic text. It registers **no page-message listener** and exposes no privileged page-to-extension command channel. The MAIN listener checks channel, action, finite/ranged coordinates and timestamps. Website scripts cannot use this channel to change configuration, read storage or access the socket.

A page can always alter its own MAIN-world JavaScript and spoof page-local messages. Page code may observe its effective geolocation behavior, which necessarily reveals whether a position or native/error action is used. This is not access to stored settings or extension privileges. The extension does not promise tamper-resistant geolocation against the very website consuming it. TLS protects network credentials; local profile storage is not an encrypted credential vault.

## Normalized model

Every source produces the same version 1 `gps` snapshot, kept internal except for its coordinate projection:

```json
{
  "type":"gps", "version":1, "source":"nmea2000",
  "status":"fix", "valid":true,
  "latitude":-31.95, "longitude":115.86,
  "altitude":2.5, "altitudeAccuracy":null,
  "speed":2.5, "course":90.0,
  "timestamp":1792800000000, "gpsTime":"2026-10-24T00:00:00.000Z",
  "age":0.2, "hdop":0.9, "quality":1,
  "accuracy":4.5, "accuracyKind":"hdop-estimate",
  "sourceAddress":23, "pgns":[126992,129025,129026,129029],
  "selectedPgns":[126992,129025,129026,129029],
  "lastReceived":1792800000000
}
```

Latitude/longitude are degrees, altitude/accuracy metres, speed m/s, course degrees true. Nullable fields stay null. `timestamp` is the real UTC reception time of the position; `gpsTime` is receiver UTC when supplied. Old or implausibly future receiver timestamps invalidate fixes. Monotonic time governs source locking, optional-field expiry and worker staleness. Repeated snapshots do not refresh the fix timestamp. Source changes and reconnections reset parser fragments and caches; a page relay retains a prior valid fix only for explicitly selected last-known fallback. The UI reports current validity and age. Accuracy is labelled HDOP × UERE or a configured fallback estimate, with no statistical confidence claim.

Signal K deltas are own-vessel only. A position-producing `$source` locks related fields to the same source; another can replace it after expiry. Invalid GNSS method or unsafe integrity invalidates fixes. Observed quality must stay fresh. NMEA 0183 validates checksums when present, coordinate hemispheres/ranges, validity/mode and UTC dates with midnight rollover. It accepts supported sentence types from standard talkers and buffers fragmented text.

## NMEA 2000 WebSocket payload contract

The selected server must perform a genuine WebSocket handshake, then deliver these payloads without extra JSON/base64 envelopes. These adapters define supported **payloads**, not transport capabilities for any particular gateway model. Neither RAW TCP nor UDP nor SocketCAN is a browser transport. Hardware compatibility has not been certified.

1. **SeaSmart PCDIN**: text `$PCDIN,pppppp,tttttttt,ss,DD...DD*hh`. Six hex PGN digits, eight gateway-time hex digits, two source-address digits, even hex data and mandatory XOR checksum. Data contains a complete PGN, including reassembled fast packets. Gateway time is not assumed to be GNSS UTC. One sentence per message, or CR/LF-delimited/fragmented records.
2. **Yacht Devices RAW**: text `hh:mm:ss.ddd R cccccccc DD DD DD DD DD DD DD DD`, CR/LF-delimited or a complete line per message. Eight hex CAN identifier digits, eight classic-CAN data bytes. Only receive (`R`) records are consumed. This uses the vendor-documented RAW record layout. It does **not** claim that YDEN-02 offers WebSocket service.
3. **Actisense NGT**: binary WebSocket frames containing a stream of `DLE STX`, command `0x93`, length, body, checksum, `DLE ETX`; DLE bytes are doubled. Checksum is the two's complement over command, length and body. Body: priority, 3-byte little-endian PGN, destination, source, 4-byte gateway time, length and already reassembled PGN data. Not Actisense ASCII, BST D0 or EBL. Fragmented/multiple packets are supported.

RAW CAN frames share fast-packet and ISO transport reassembly keyed by source/destination/PGN/sequence. Timeout is 750 ms; fast packets are at most 223 bytes. ISO TP BAM and passive RTS data streams check sequence/length and honor aborts. Sessions are capped at 256 per transport. The extension never claims an address, transmits CAN requests, or acknowledges RTS/CTS; addressed transfers require an existing active receiver at the gateway's CAN side. Single-frame/fast-packet GPS PGNs are the normal path.

Supported PGNs: 129025 signed 32-bit position at 1e-7 degrees; 129026 SOG .01 m/s and true COG 1e-4 rad; 129029 signed 64-bit GNSS position at 1e-16 degrees, altitude, time, method/integrity and HDOP; 126992 system time. Reserved/error/NA numerics become null. Methods 1–5 and integrity 0/1 are accepted; estimated/manual/simulated/unsafe data is rejected. Other PGNs are ignored.

Source-address selection locks to a position-producing receiver; motion/time packets cannot steal selection. Another address is eligible only after position expiry. A fixed address never fails over. All caches are cleared before switching. Once 129029 has been observed, 129025 cannot override invalid or expired quality. Rapid-only data has unknown fix method. Address stability is assumed; changes of physical devices behind the same source address require gateway-side source management.

## Browser API semantics

The MAIN-world script is injected at document start and preserves the original native methods. It uses asynchronous callbacks, unique watch IDs, request timeout, maximumAge, cancellation and unchanged timestamps. Watches deduplicate repeated snapshots, fan out each new fix and recover after outages; native watches are cleared when live marine fixes resume. Explicit last-known fallback uses the last valid position, not invalid new coordinates. Relay and MAIN expiry timers handle total input/message loss. Secure contexts, Permissions Policy and explicit browser permission denial are checked. Native fallback retains normal browser behavior. Substituted data in a `prompt` permission state uses extension authorization rather than a native location dialog.

## Primary protocol references

- [Signal K streaming API](https://github.com/SignalK/specification/blob/master/mdbook/src/streaming_api.md) and [server WebSocket implementation](https://github.com/SignalK/signalk-server/blob/master/src/interfaces/ws.ts).
- [Signal K security](https://signalk.org/specification/1.7.0/doc/security.html) and [server security connection types](https://github.com/SignalK/signalk-server/blob/master/src/security.ts), including query-token support.
- [Yacht Devices YDEN-02 manual](https://www.yachtd.com/downloads/yden02.pdf) and [YDWG-02 manual](https://www.yachtd.com/downloads/ydwg02.pdf), RAW wire layout. These document raw TCP/UDP transports, not WebSocket compatibility.
- [SeaSmart protocol](http://www.seasmart.net/pdf/SeaSmart_HTTP_Protocol_RevG_043012.pdf) and [open gateway format documentation](https://github.com/ieb/N2KNMEA0183Wifi#seasmart-format-reference), PCDIN complete PGN layout, independent of transport.
- [Actisense SDK](https://github.com/Actisense/SDK), NGT/BST-93 binary framing.
- [CANboat public PGN definitions](https://github.com/canboat/canboat/blob/master/docs/canboat.json), Apache-2.0 protocol reference. No CANboat source or runtime is vendored. The four narrowly scoped decoders are implemented in JavaScript.

No NMEA certification is claimed. Development dependencies (`playwright`, `ws`, `fflate`) are not included in the installed extension and are never needed for ordinary use.
