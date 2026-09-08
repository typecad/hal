// Hardware test for the @typecad/hal HTTP client.
//
// Hits the local test server (npm run test:http) over plain HTTP to verify
// every HTTP verb with real stateful CRUD operations — not just status codes.
//
// Run the server in one terminal, then the test in another:
//   Terminal 1:  npm run test:http
//   Terminal 2:  npm run test:hw:http -- --port COM10
//
// The @typecad/hal/testing harness has no async/await — every HAL call here uses
// the blocking top-level form. Values are passed inline to .expect() via IIFEs
// so the preprocessor hoists them as `: number` (→ double), which makes the
// transpiler's printf format (%g) type-check under GCC 15's -Werror=format=.
//
// URLs must be full string literals (not template literals) because the HTTP
// factory resolver expects a string literal — a template expression like
// `${BASE}/echo` doesn't resolve and leaves the URL as the raw field name.

// === EDIT THESE BEFORE FLASHING ===
const WIFI_SSID = "Skynet";
const WIFI_PASSWORD = "justin04";
// Your machine's LAN IP + port (the one `npm run test:http` reports).
// Each URL must be a complete string literal — see comment above.
const ECHO_URL = "http://192.168.2.184:8080/echo";
const STATUS_404_URL = "http://192.168.2.184:8080/status/404";
const STATUS_201_URL = "http://192.168.2.184:8080/status/201";
const STATUS_500_URL = "http://192.168.2.184:8080/status/500";
const HEADERS_URL = "http://192.168.2.184:8080/headers";
const ITEMS_URL = "http://192.168.2.184:8080/items?key=crud";
// HTTPS (TLS) endpoints — the https test server (port 8443). The server cert's
// SAN must include your LAN IP (see certs/README.md to regenerate
// if your IP differs).
const HTTPS_ECHO_URL = "https://192.168.2.184:8443/echo";
const HTTPS_STATUS_201_URL = "https://192.168.2.184:8443/status/201";
const HTTPS_HEADERS_URL = "https://192.168.2.184:8443/headers";
// ==================================

import { describe, done } from '@typecad/hal/testing';
import { WiFi, Request } from '@typecad/hal';

// CA certificate for the local HTTPS test server (self-signed; pinned via
// caCert). Inlined as a single string literal so it lands at file scope: the
// transpiler hoists a single-literal const to a global, but a multi-line
// concatenation or an imported const would land in main()-local scope (or a
// separate TU) where the per-test functions can't see it. Keep in sync with
// certs/ca.crt — see that README to regenerate.
const CA_CERT_PEM = "-----BEGIN CERTIFICATE-----\nMIIDUzCCAjugAwIBAgIUfRQUm6IDRUUG1oRt6qNXmysZ6LgwDQYJKoZIhvcNAQEL\nBQAwMTEdMBsGA1UEAwwUVHlwZUNBRCBIVFRQIFRlc3QgQ0ExEDAOBgNVBAoMB1R5\ncGVDQUQwHhcNMjYwODAzMDYwNDIyWhcNMzYwNzMxMDYwNDIyWjAxMR0wGwYDVQQD\nDBRUeXBlQ0FEIEhUVFAgVGVzdCBDQTEQMA4GA1UECgwHVHlwZUNBRDCCASIwDQYJ\nKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMsrQFM93bvXAoUOUYYtNWwSssO02VZP\npMli0uHVxFBE0pqUa+uvDjw1RCKJ+PJL33svQLhtj+cXOriA2G30waknHpMPf1aM\najO4CIafX2FcWHvexQhCqfEcvCrFBxDAQNFdYsNMbI+AC/ovvTDaLdzcdpIcfoO5\nkE/Iu+k4ugcaqjnAPW0FME+mV2sp5/hez5LP/IYhpEuNvpvJZ8w3eZHPwxruLMNZ\nn8LmtVzg093yPLijjOvXPQi2O7P3xocUbU+w/5ON1NkXzqpVh+O7fHnkKiJp6ANu\nd5WDjoRNSJqCA467Ch9mDFeUNtureg7GzR1ILqchSdxX8eETm6Jh9dUCAwEAAaNj\nMGEwHwYDVR0RBBgwFoIUVHlwZUNBRCBIVFRQIFRlc3QgQ0EwDwYDVR0TAQH/BAUw\nAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFKWORpJuIVWrKQKrgm058sJN\nIQ+3MA0GCSqGSIb3DQEBCwUAA4IBAQCyfyasbiXOdmNCh2ybiLqpzDr6dbcZUSJS\nRaNZgYBctpeeWQHbNh/lObkzdhSr7sHNn1IgaWxSyxsOs8kBsAXRPluyy8oDxxMZ\neOH+XIa9fcm0fh+fkmlCHIJNzwFA0dcHv4lnrjohlVSfs3tC2TSlaWJLFef1oXIs\ngl1HLscOn9OrEtIHPKhiSJ1rgGJyoFoZGw7XO3AnoWlCKcg0W8HhmtKuqv5GKIEA\n0TsliYmsnjTj0449/Izyqlqa5GW9V2q4VJWZwMQ0vfnJMFSaRsJQqnw5WbkKmy5a\nov/Lt+pikXo1wnSW7+0ZPROtLry4SLOn+qTOkqQi8vpInTStM3ss\n-----END CERTIFICATE-----"

const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PASSWORD, timeoutMs: 30000 });
wifi.join();

// ── Verb lowering: each method maps to the framework's HTTP verb enum ──
// (esp_http_client: HTTP_METHOD_*; Zephyr http parser: HTTP_*). The test
// itself is framework-neutral — it only calls @typecad/hal verbs — so it runs
// unchanged once typecad-hal.config.ts points at a given framework.

describe('HTTP client — verb lowering')
  .it('GET lowers correctly')
    .expect((() => { const r = new Request(Request.GET, ECHO_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(200)
  .it('POST lowers correctly')
    .expect((() => { const r = new Request(Request.POST, ECHO_URL, { timeoutMs: 10000, body: 'test' }); r.send(); return r.status(); })()).toBe(200)
  .it('PUT lowers correctly')
    .expect((() => { const r = new Request(Request.PUT, ECHO_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(200)
  .it('DELETE lowers correctly')
    .expect((() => { const r = new Request(Request.DELETE, ECHO_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(200)
  .it('PATCH lowers correctly')
    .expect((() => { const r = new Request(Request.PATCH, ECHO_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(200)
  .it('HEAD lowers correctly')
    .expect((() => { const r = new Request(Request.HEAD, ECHO_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(200);

// ── Status code parsing ─────────────────────────────────────────────

describe('HTTP client — status codes')
  .it('404 route returns 404')
    .expect((() => { const r = new Request(Request.GET, STATUS_404_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(404)
  .it('201 route returns 201')
    .expect((() => { const r = new Request(Request.GET, STATUS_201_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(201)
  .it('500 route returns 500')
    .expect((() => { const r = new Request(Request.GET, STATUS_500_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(500);

// ── Stateful CRUD: real data mutation across requests ───────────────
// The /items endpoint holds an in-memory key-value store. We:
//   1. GET an item that doesn't exist → 404
//   2. POST to create it → 201
//   3. GET to read it back → 200
//   4. PUT to update its value → 200
//   5. PATCH to partially update → 200
//   6. DELETE to remove it → 200
//   7. GET to confirm it's gone → 404
// This proves the verbs actually mutate server state, not just return 200.

describe('HTTP client — CRUD state mutation')
  .it('GET missing item returns 404')
    .expect((() => { const r = new Request(Request.GET, ITEMS_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(404)
  .it('POST creates item and returns 201')
    .expect((() => { const r = new Request(Request.POST, ITEMS_URL, { timeoutMs: 10000, body: '{"value":"original"}', json: true }); r.send(); return r.status(); })()).toBe(201)
  .it('GET created item returns 200')
    .expect((() => { const r = new Request(Request.GET, ITEMS_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(200)
  .it('PUT updates item and returns 200')
    .expect((() => { const r = new Request(Request.PUT, ITEMS_URL, { timeoutMs: 10000, body: '{"value":"updated"}', json: true }); r.send(); return r.status(); })()).toBe(200)
  .it('PATCH partially updates item and returns 200')
    .expect((() => { const r = new Request(Request.PATCH, ITEMS_URL, { timeoutMs: 10000, body: '{"value":"patched"}', json: true }); r.send(); return r.status(); })()).toBe(200)
  .it('DELETE removes item and returns 200')
    .expect((() => { const r = new Request(Request.DELETE, ITEMS_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(200)
  .it('GET deleted item returns 404')
    .expect((() => { const r = new Request(Request.GET, ITEMS_URL, { timeoutMs: 10000 }); r.send(); return r.status(); })()).toBe(404);

// ── Headers ─────────────────────────────────────────────────────────

describe('HTTP client — headers')
  .it('headers endpoint returns 200 with custom header set')
    .expect((() => { const r = new Request(Request.GET, HEADERS_URL, { timeoutMs: 10000 }); r.header('X-Custom', 'typecad-hal-value'); r.send(); return r.status(); })()).toBe(200);

// ── HTTPS with caCert (real TLS verify) ────────────────────────────
// Pins the local test server's CA (certs/ca.crt) so mbedTLS performs a full
// handshake + chain verification. Proves http.set_ca_cert + IPPROTO_TLS_1_2 +
// TLS_SEC_TAG_LIST + TLS_PEER_VERIFY_REQUIRED on a real TLS session.

describe('HTTP client — HTTPS with caCert')
  .it('GET over HTTPS with pinned CA returns 200')
    .expect((() => { const r = new Request(Request.GET, HTTPS_ECHO_URL, { timeoutMs: 15000, caCert: CA_CERT_PEM }); r.send(); return r.status(); })()).toBe(200)
  .it('POST over HTTPS with pinned CA returns 200')
    .expect((() => { const r = new Request(Request.POST, HTTPS_ECHO_URL, { timeoutMs: 15000, caCert: CA_CERT_PEM, body: 'test' }); r.send(); return r.status(); })()).toBe(200)
  .it('HTTPS status code (201) parses through TLS')
    .expect((() => { const r = new Request(Request.GET, HTTPS_STATUS_201_URL, { timeoutMs: 15000, caCert: CA_CERT_PEM }); r.send(); return r.status(); })()).toBe(201)
  .it('HTTPS custom header reaches server through TLS')
    .expect((() => { const r = new Request(Request.GET, HTTPS_HEADERS_URL, { timeoutMs: 15000, caCert: CA_CERT_PEM }); r.header('X-Custom', 'typecad-hal-value'); r.send(); return r.status(); })()).toBe(200);

// ── HTTPS with insecure (verify skipped) ───────────────────────────
// insecure() sets TLS_PEER_VERIFY_NONE — the handshake completes but the cert
// is not checked. Proves http.set_insecure independently of the CA path.

describe('HTTP client — HTTPS with insecure')
  .it('GET over HTTPS with insecure() returns 200')
    .expect((() => { const r = new Request(Request.GET, HTTPS_ECHO_URL, { timeoutMs: 15000, insecure: true }); r.send(); return r.status(); })()).toBe(200);

done();
