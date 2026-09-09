---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

MQTT gains CA pinning: `mqtts://` can now run verified TLS, the analogue of
Request's `caCert`.

`new Mqtt(uri, opts)` accepts `caCert` (a PEM literal or a top-level string
const — the PEM-as-const pattern the hardware suite uses). The PEM is
DER-decoded at emit time (this tree's tf-psa-crypto mbedTLS ships no PEM
parser), registered via `tls_credential_add` as a CA_CERTIFICATE sec tag, and
the handshake verifies the broker's chain with TLS_PEER_VERIFY_REQUIRED —
hostname (SNI + identity) set for name hosts, chain-only for IP literals
(the mbedtls SAN-matching gap, same policy as the HTTPS path). `mqtts://`
WITHOUT a CA stays encrypted-but-unverified (TLS_PEER_VERIFY_NONE) — the
strongest that form can express, now an explicit choice rather than the only
one. On-hardware, pinned-CA is subject to the same documented tf-psa-crypto
symbol-matrix limitation as the HTTPS pinned tests (EPERM at connect);
codegen + link are complete and verified (full west compile on the
ESP32-S3 devkitC).

Machinery: a `mqtt.set_ca_cert` HAL op (IR + registry + resolver plugin +
manifest), a dedicated `mqttCtorFields()` capture (like `requestCtorFields`)
serving both the variable and bare `new Mqtt(...).connect()` receiver forms,
and an `MqttOpts` exported type. The capture also fixes a latent bug: uri +
clientId were stored unquoted, so an identifier-like clientId ("probe") or
single-word host emitted as a bare C++ identifier — construction facts are
now stored as quoted literals end to end.

Also: the stale network hardware test `mqtt-client.test.ts` still targeted
the deleted `MQTT.*` static surface — rewritten onto the `Mqtt` class with
plain, encrypted-unverified, and CA-pinned round-trips; docs
(docs/hal/networking.md) document the caCert fact and the stale
`mqtt.close()` rename is fixed.
