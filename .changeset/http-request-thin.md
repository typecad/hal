---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

HTTP client joins the thin HAL: the Http/HttpClass singleton factories and
the HttpRequest fluent builder are replaced by a fact-carrying Request.

The new `new Request(method, url, opts)` carries the whole request policy at
construction — method tokens (Request.GET/POST/PUT/DELETE/HEAD/PATCH; plain
strings also accepted), URL, and the opts { timeoutMs, body, json,
insecure, caCert }. `header(name, value)` chains for multi-header requests
(one op per header). `send()` lowers the facts into the shim (timeout/body/
TLS mode) and performs the request; the response reads from the same
instance (status/ok/text/contentLength/responseHeader — unchanged).
Awaited send inside async functions still splits into the background
request + done-poll. Removed: the Http singleton + its six verb factories
and the factory-verb/factory-chaining machinery in the parser and
transformer, the http.reset op (fresh shim state now rides http.begin —
one reset per request instead of one per factory), the builder setters as
user API (timeout/maxBody/body/jsonBody/insecure/caCert chained calls), and
the HttpMethod numeric enum (the class tokens are the strings). The
set_insecure op carries its flag; absent body/caCert ops elide in the
lowering.

The transformer captures Request construction facts (shared helper also
serving bare `new Request(...).send()` receivers via resolveHALReceiver),
including identifier opts resolving to top-level string consts — the
PEM-as-const pattern the hardware suite uses (caCert: CA_CERT_PEM decodes
to the DER byte array at emit time).

Hardware-verified on the ESP32-S3 against the LAN test server: all six
verbs, status-code parsing (404/201/500), the seven-step CRUD mutation,
custom headers, and HTTPS with insecure all pass through the new surface
(19/24 asserts + the four pinned-CA tests still blocked by the documented
tf-psa-crypto symbol-matrix limitation). All four wifi-demo HTTP programs
and both http test suites are migrated.
