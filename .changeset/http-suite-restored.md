---
'@typecad/hal': patch
'@typecad/framework-zephyr': patch
---

Restore the HTTP/S hardware suite and verify the HTTP client on the thin HAL.

The deleted network test infrastructure is back: server.ts/start-server.ts
(the LAN HTTP+HTTPS test server with /echo, /status/[code], /headers, and the
stateful /items CRUD store), certs, http-client.test.ts, and the npm scripts.
The suite is retargeted at the connected ESP32-S3 (CH34x identity,
resetAfterOpen) and joins Skynet through the thin WiFi station; the test
server runs non-interactive via WIFI_SSID/WIFI_PASSWORD env vars.

HttpRequest.send() drops its Promise<boolean> shim — it is a plain blocking
boolean now (wifi.join discipline; the async machinery's send_start + done
split is unchanged, and a dead unreachable plugin line is gone).

Hardware-verified on the S3 against the local server: 23/24 asserts green —
all six verbs against /echo, status-code parsing (404/201/500), the full
seven-step CRUD state mutation on /items, custom headers, and HTTPS with
insecure() through the TLS listener. Fixes made on the way: a stale
CONFIG_MBEDTLS_PEM_CERTIFICATE_FORMAT assignment (symbol no longer exists on
this tree — it aborted every http Kconfig), and caCert() lowering now decodes
the PEM to a DER byte array at emit time (this tree's tf-psa-crypto mbedTLS
has no PEM parser). KNOWN LIMITATION: pinned-CA (verified) TLS still fails at
connect with EPERM — the tf-psa-crypto symbol matrix needs more than the
single-ciphersuite select provides, and forcing the RSA public-key symbol
regressed the insecure path (two hardware cycles proved it upstream).
Documented in the kconfig block; revisit when the upstream matrix is mapped.
