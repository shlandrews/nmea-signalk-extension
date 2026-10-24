# Standalone installation

## All supported platforms

Use Chrome or Chromium 116+. The extension's files are identical on Windows, Linux, macOS and Raspberry Pi OS Bookworm ARM64. You do not need Python, Node.js, a terminal, systemd, a native messaging host or a separately installed companion app.

1. Download/extract the source or extension ZIP.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**, select `chromium-extension/` (or the extracted extension ZIP directory containing `manifest.json`).
5. Pin **Marine GPS Geolocation** to the toolbar and open its popup.
6. Enter your server address, enable **On**, and click **Save & connect**.

Reload tabs that existed before installation. Allow the extension to run on the websites you use in Chrome's extension site-access settings. You can disable substitution globally or for the active website in the popup. Chrome must stay running for continuous GPS updates; the popup can stay closed.

## Signal K settings

| Field | Example |
| --- | --- |
| GPS source | Signal K WebSocket |
| Protocol | `ws://` (or `wss://` when TLS is configured) |
| Server hostname/IP | `192.168.0.109` |
| Server port | `3000` |
| WebSocket path | `/signalk/v1/stream` |
| Authentication | None, or an existing Signal K access token |

Use only the hostname/IP in the host field, with no scheme or path. IPv6 addresses are accepted, including brackets. Server, port, protocol and path are configurable separately. The path cannot contain query parameters; the extension sets subscription and authentication parameters itself. Use a certificate trusted by Chromium for `wss`. A hostname in the URL must match the certificate. The extension cannot bypass TLS errors or a server's Origin restrictions; configure the server to allow the extension's origin where required.

For authentication, obtain a read token from the existing Signal K server administrator, choose **Access token (token query parameter)** and enter it. Query-token authentication is supported by the Signal K server implementation. Header-only or custom challenge/response authentication is not implemented. Browser-native WebSockets do not support arbitrary Authorization headers. Credentials are profile-local, not cloud-synced or encrypted by this extension. Keep the browser profile private. They are never included in page messages.

No other software is installed on this computer. The vessel's existing Signal K server or WebSocket-capable gateway is the data source, like any network server.

## NMEA WebSocket inputs

Choose **NMEA 0183 over WebSocket** and enter the gateway's documented WebSocket host, port and path. It must send plain NMEA text, either newline-delimited records or a complete checksummed sentence per message. Fragmented records across messages are also buffered. JSON envelopes and arbitrary vendor binary protocols are not NMEA text.

For **NMEA 2000 over WebSocket**, select the documented payload format:

| Format | WebSocket message payload |
| --- | --- |
| SeaSmart PCDIN | Text `$PCDIN,...*hh` records containing complete PGNs |
| Yacht Devices RAW | Text timestamp + `R` + 29-bit CAN identifier + eight hex bytes |
| Actisense NGT `0x93` | Binary messages containing DLE-framed receive packets; not text, ASCII Actisense, EBL or BST D0 |

Select at least one position PGN (129025 or 129029); use all four for position, motion, time and quality. An optional decimal source address `0`–`253` fixes selection to that receiver; blank locks automatically until position expiry.

**These are payload adapters, not proof of a specific gateway model's WebSocket compatibility.** A gateway must explicitly expose the selected payload over a WebSocket transport. No physical NMEA gateway model has been validated in this environment. YDEN-02 RAW is documented for TCP/UDP, so its ordinary RAW port cannot be entered here. W2K or other gateway TCP ports likewise need documented WebSocket support before use. If your hardware only exposes raw sockets or SocketCAN, the standalone extension cannot access it. Use a compatible network source already present on the vessel; this extension does not provide an external bridge.

## Updating from version 1

Replace the extension directory and click **Reload** on `chrome://extensions`. Legacy bridge URLs and bridge tokens are removed from extension settings. A prior Signal K endpoint/token can be migrated, but the override starts disabled and requires you to verify settings and enable it. Unsupported TCP/UDP/SocketCAN selections reset to the Signal K setup screen; their ports are never silently reinterpreted as WebSockets. The former bridge implementation, services and Python scripts are no longer part of this repository. Previously installed external services are not contacted or managed by this extension; remove them using your system's normal administration tools if no longer needed.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Connecting / disconnected | Exact WebSocket endpoint, network reachability, server running, port, path, firewall |
| Connection error with authentication | Token validity, read permissions, query authentication support, server Origin policy |
| TLS connection error | Trusted certificate, correct host, certificate validity and system clock |
| No valid fix | Live position source, GNSS validity/quality, selected PGNs/address, payload format |
| Stale position | GPS stopped updating or sent old timestamps; verify server and computer UTC clocks |
| RAW gateway never connects | Confirm actual WebSocket support; raw TCP/UDP ports are not compatible |
| Motion missing | True COG/SOG from the same source; 129026 enabled; optional fields expire independently |
| New receiver ignored | Automatic mode waits for position expiry; a fixed source address never fails over |
| Website receives native position | Reload tab, enable global/site switches, grant extension site access, check fallback |
| Website receives permission denied | Secure context, browser site permission, embedding document Permissions Policy |
| Sleep / browser restart interrupted GPS | Leave Chrome running; wait for reconnection; opening a website or popup also triggers recovery |

For diagnostics, inspect the service worker and offscreen document from `chrome://extensions`; network details there may contain authentication URLs. Do not share them unredacted. Normal popup errors use static text without tokens or raw server error messages.
