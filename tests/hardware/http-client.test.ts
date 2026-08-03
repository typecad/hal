// Hardware test for the @typecad/hal HTTP client.
//
// Hits the local test server (npm run test:http) over plain HTTP to verify
// every HTTP verb with real stateful CRUD operations — not just status codes.
//
// Run the server in one terminal, then the test in another:
//   Terminal 1:  npm run test:http
//   Terminal 2:  npm run test:hw:http -- --port COM10
//
// The @typecad/expect harness has no async/await — every HAL call here uses
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
// ==================================

import { describe, done } from '@typecad/expect';
import { WiFi, Http } from '@typecad/hal';

WiFi.connect(WIFI_SSID, WIFI_PASSWORD, 30000);

// ── Verb lowering: each method maps to the framework's HTTP verb enum ──
// (esp_http_client: HTTP_METHOD_*; Zephyr http parser: HTTP_*). The test
// itself is framework-neutral — it only calls @typecad/hal verbs — so it runs
// unchanged once cuttlefish.config.ts points at a given framework.

describe('HTTP client — verb lowering')
  .it('GET lowers correctly')
    .expect((() => { const r = Http.get(ECHO_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(200)
  .it('POST lowers correctly')
    .expect((() => { const r = Http.post(ECHO_URL); r.timeout(10000); r.body('test'); r.send(); return r.status(); })()).toBe(200)
  .it('PUT lowers correctly')
    .expect((() => { const r = Http.put(ECHO_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(200)
  .it('DELETE lowers correctly')
    .expect((() => { const r = Http.del(ECHO_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(200)
  .it('PATCH lowers correctly')
    .expect((() => { const r = Http.patch(ECHO_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(200)
  .it('HEAD lowers correctly')
    .expect((() => { const r = Http.head(ECHO_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(200);

// ── Status code parsing ─────────────────────────────────────────────

describe('HTTP client — status codes')
  .it('404 route returns 404')
    .expect((() => { const r = Http.get(STATUS_404_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(404)
  .it('201 route returns 201')
    .expect((() => { const r = Http.get(STATUS_201_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(201)
  .it('500 route returns 500')
    .expect((() => { const r = Http.get(STATUS_500_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(500);

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
    .expect((() => { const r = Http.get(ITEMS_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(404)
  .it('POST creates item and returns 201')
    .expect((() => { const r = Http.post(ITEMS_URL); r.timeout(10000); r.jsonBody('{"value":"original"}'); r.send(); return r.status(); })()).toBe(201)
  .it('GET created item returns 200')
    .expect((() => { const r = Http.get(ITEMS_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(200)
  .it('PUT updates item and returns 200')
    .expect((() => { const r = Http.put(ITEMS_URL); r.timeout(10000); r.jsonBody('{"value":"updated"}'); r.send(); return r.status(); })()).toBe(200)
  .it('PATCH partially updates item and returns 200')
    .expect((() => { const r = Http.patch(ITEMS_URL); r.timeout(10000); r.jsonBody('{"value":"patched"}'); r.send(); return r.status(); })()).toBe(200)
  .it('DELETE removes item and returns 200')
    .expect((() => { const r = Http.del(ITEMS_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(200)
  .it('GET deleted item returns 404')
    .expect((() => { const r = Http.get(ITEMS_URL); r.timeout(10000); r.send(); return r.status(); })()).toBe(404);

// ── Headers ─────────────────────────────────────────────────────────

describe('HTTP client — headers')
  .it('headers endpoint returns 200 with custom header set')
    .expect((() => { const r = Http.get(HEADERS_URL); r.header('X-Custom', 'cuttlefish-value'); r.timeout(10000); r.send(); return r.status(); })()).toBe(200);

done();
