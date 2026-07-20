# Networking (WiFi & HTTP)

TypeCAD exposes the ESP32's WiFi radio and HTTP client as two singletons — `WiFi` and `Http` — that lower directly to native ESP-IDF (`esp_wifi`, `esp_http_client`), with no Arduino compatibility layer in the path. The same calls work in three styles: **blocking** at the top level, **event-callback** for fire-and-forget programs, and **`async`/`await`** for cooperative multi-task programs. A compile-time validator flags the common mistakes (HTTP without a WiFi link, blocking calls inside `loop()`, short AP passwords) before you flash.

---

## WiFi

`WiFi` is the STA/AP radio. It is a singleton: there is one radio, one link state. State is tracked in a `WiFiStatus` enum (`Idle`, `Connecting`, `Connected`, `ConnectFailed`, `Disconnected`) updated by the IDF event loop.

### Basic connect

The simplest form blocks at the top level until the link is up (or the 15 s default deadline expires):

```typescript
import { WiFi } from '@typecad/hal';

WiFi.connect("HomeNet", "hunter22");
console.log(WiFi.localIP());
```

`connect()` returns a `Promise<boolean>`, but at the top level the promise is meaningless — the call has already blocked. The boolean matters only when you `await` it (see below).

### Configuration before connect

Tune the link before calling `connect()`. Each setter returns the singleton, so calls chain:

```typescript
WiFi
  .hostname("sensor-01")        // DHCP hostname / mDNS name
  .staticIP("10.0.0.5", "10.0.0.1", "255.255.255.0", "8.8.8.8")
  .powerSave("none")            // disable modem power save for lower latency
  .txPower(10)                  // dBm, clamped to [2, 20]
  .autoReconnect(true);         // re-associate automatically on drops (default)
WiFi.connect("HomeNet", "hunter22", 30000); // 30 s deadline
```

TX power is stashed and applied once the radio is actually up — `esp_wifi_set_max_tx_power` is a no-op before `esp_wifi_start`, so `txPower()` works whether you call it before or after `connect()`.

> **If your board reboots at `wifi: connecting`** with `E BOD: Brownout detector was triggered` in the serial log, your USB power supply can't deliver the PA's transmit-current spike at full power. This is common on cheap dev kits and long/thin USB cables. Call `WiFi.txPower(10)` (or lower) before `WiFi.connect()` — 10 dBm is plenty for most bench work and roughly halves peak PA current. The root cause is hardware, not firmware; this is a workaround that reduces the current draw enough to keep the rail above the ESP32-S3's 2.44 V brownout threshold. For production, fix the supply (shorter cable, beefier 5 V source, bulk capacitance on the 3.3 V rail).

### Async / cooperative await

Inside an `async function`, `await WiFi.connect(...)` lowers to a **non-blocking start + poll** pair: `__tc_wifi_connect_start(...)` arms the connection, then the async state machine polls `__tc_wifi_is_connected()` each `loop()` tick until it returns true or the deadline lapses. This is what lets several tasks share the radio without any of them blocking `loop()`:

```typescript
import { WiFi, delay } from '@typecad/hal';

async function network() {
  await WiFi.connect("HomeNet", "hunter22", 30000);
  console.log(WiFi.localIP());
}

async function watchLink() {
  while (true) {
    await WiFi.untilDisconnected();
    console.log("link lost");
    await WiFi.untilConnected(0); // 0 = wait forever
    console.log("link restored");
  }
}

network();
watchLink();
```

> Value-position awaits (`const ok = await WiFi.connect(...)`) cannot suspend mid-expression and fall back to the blocking shim. Use statement-position (`await WiFi.connect(...); WiFi.isConnected()`) to get the cooperative form.

### Event-callback style

If you don't want a state machine at all, register callbacks and use `connectAsync()`:

```typescript
WiFi.onGotIP(() => console.log("online"));
WiFi.onDisconnect(() => console.log("link lost, auto-reconnecting"));
WiFi.connectAsync("HomeNet", "hunter22");

while (true) {
  if (WiFi.isConnected()) { /* … */ }
  delay(250);
}
```

### SoftAP

Bring the radio up as an access point instead. Useful for provisioning:

```typescript
WiFi.apChannel(6).apMaxClients(4);
WiFi.startAP("cuttlefish-setup", "config123"); // ≥ 8 chars (WPA2)
console.log(WiFi.apIP());
console.log(`${WiFi.apClientCount()} client(s)`);
```

The compile-time validator rejects `startAP` with a literal password shorter than 8 characters — `esp_wifi` would reject it at runtime anyway, but failing at build time is friendlier.

### Scanning

A blocking `scan()` populates a result array you index into:

```typescript
const n = WiFi.scan();
for (let i = 0; i < n; i++) {
  console.log(`${WiFi.scanSSID(i)}  ${WiFi.scanRSSI(i)}dBm  ch${WiFi.scanChannel(i)}`);
}
```

Inside an `async function`, `await WiFi.scan()` lowers to a non-blocking scan-start + scan-done poll.

### Saved credentials (NVS)

Persist SSID/password in NVS so a field device reconnects after a power cycle without them being in firmware:

```typescript
WiFi.saveCredentials("HomeNet", "hunter22");
// …later, possibly after a reboot:
if (!WiFi.connectSaved()) {
  WiFi.startAP("cuttlefish-setup", "config123"); // fall back to AP provisioning
}
```

`clearCredentials()` wipes the slot.

---

## HTTP

`Http` is a single-slot HTTP/S client. Build a request with the `Http.get/post/put/del/head/patch` factories, configure it fluently, then call `send()`. Response state lives on the request object until the next `send()`.

### Building a request

```typescript
import { Http, WiFi } from '@typecad/hal';

WiFi.connect("HomeNet", "hunter22");

const req = Http.get("https://httpbin.org/get");
req.header("X-Device", "cuttlefish").timeout(10000);
req.send();
console.log(req.status());     // 200
console.log(req.ok());         // true
console.log(req.text());       // response body, valid until the next send()
console.log(req.responseHeader("Content-Type"));
```

### POST with a body

```typescript
const post = Http.post("https://httpbin.org/post");
post.jsonBody('{"temp":21.5,"rssi":' + WiFi.rssi() + '}'); // sets Content-Type: application/json
post.send();
console.log(post.text());
```

### TLS / HTTPS

HTTPS just works — the ESP x509 certificate bundle is attached by default. Two opt-in modes:

```typescript
Http.get("https://internal.corp/api")
    .caCert(myPemString)   // pin a specific CA (e.g. a private CA)
    .send();

Http.get("https://lab-server.local")  // self-signed lab endpoint
    .insecure()            // skip cert verification (lab only)
    .send();
```

`caCert` takes a PEM string; `insecure` skips both common-name check and bundle verification. Don't ship `insecure()` in production firmware.

### Async send

Inside an `async function`, `await req.send()` runs the request on a short-lived FreeRTOS task and polls for completion, so a slow request never stalls the rest of the program:

```typescript
async function pollCloud() {
  while (true) {
    await WiFi.untilConnected(0);
    const req = Http.get("https://httpbin.org/get");
    await req.send();
    console.log(`${req.status()}`);
    await delay(5000);
  }
}
```

Same value-vs-statement caveat as WiFi: use statement-position (`await req.send(); req.status()`) for the cooperative split; value-position falls back to blocking.

---

## API Reference

### WiFi
| Method | Returns | Description |
| :--- | :--- | :--- |
| `connect(ssid, pass?, timeoutMs?)` | `Promise<boolean>` | Block until connected or deadline. Default 15 s. |
| `connectAsync(ssid, pass?)` | `void` | Fire-and-forget; poll `isConnected()` or use callbacks. |
| `untilConnected(timeoutMs?)` | `Promise<boolean>` | Awaitable wait. `0` = wait forever. |
| `untilDisconnected()` | `Promise<void>` | Awaitable wait for link drop. |
| `disconnect()` | `void` | Temporarily disable auto-reconnect, disassociate. |
| `isConnected()` | `boolean` | True once `IP_EVENT_STA_GOT_IP` has fired. |
| `status()` | `WiFiStatus` | `Idle`/`Connecting`/`Connected`/`ConnectFailed`/`Disconnected`. |
| `localIP()` / `rssi()` / `macAddress()` | `string` / `number` / `string` | Link info. |
| `hostname(name)` / `staticIP(...)` / `powerSave(mode)` / `txPower(dbm)` / `autoReconnect(b)` | `this` | Configuration setters (chainable). |
| `onConnect(fn)` / `onDisconnect(fn)` / `onGotIP(fn)` | `void` | Register an event callback. |
| `startAP(ssid, pass?)` | `boolean` | Bring the radio up as an AP. |
| `apChannel(ch)` / `apMaxClients(n)` / `apHidden(b)` | `this` | AP configuration (chainable). |
| `apClientCount()` / `apIP()` | `number` / `string` | AP runtime info. |
| `scan()` / `scanAsync()` | `number` / `Promise<void>` | Populate the scan result array. |
| `scanSSID(i)` / `scanRSSI(i)` / `scanChannel(i)` / `scanEncryption(i)` | various | Read the `i`th scan result. |
| `saveCredentials(ssid, pass)` / `connectSaved(timeoutMs?)` / `clearCredentials()` | `void` / `boolean` / `void` | NVS-backed credential storage. |

### Http / HttpRequest
| Method | Returns | Description |
| :--- | :--- | :--- |
| `Http.get/post/put/del/head/patch(url)` | `HttpRequest` | Factory; one request at a time. |
| `header(name, value)` | `this` | Add a request header (max 8). |
| `timeout(ms)` | `this` | Per-request timeout. |
| `maxBody(bytes)` | `this` | Cap the heap-allocated response buffer (default 8 KB). |
| `body(data)` / `jsonBody(json)` | `this` | Set the request body (json sets Content-Type). |
| `insecure()` / `caCert(pem)` | `this` | TLS verification overrides. |
| `send()` | `Promise<boolean>` | Send the request; success status. |
| `status()` / `ok()` | `number` / `boolean` | HTTP status code / 2xx test. |
| `text()` | `string` | Response body, valid until the next `send()`. |
| `contentLength()` | `number` | Declared response body length. |
| `responseHeader(name)` | `string` | Lookup a response header. |

---

## Compile-time checks

The network validator (`network-validation.ts`) emits five diagnostics before you flash. Two are errors; three are warnings.

| Code | Severity | Fires when |
| :--- | :--- | :--- |
| `wifi-no-radio` | error | Any `wifi.*` or `http.*` op on an architecture with no WiFi radio (e.g. AVR). |
| `wifi-ap-password-short` | error | `startAP` with a literal password under 8 characters. |
| `http-without-wifi` | warning | HTTP requests are made but the program never brings the WiFi link up. |
| `wifi-blocking-in-loop` | warning | A blocking connect/scan/HTTP-send appears directly in `loop()`. Move it into an `async function` and `await` it. |
| `http-max-body-large` | warning | `maxBody(>65536)` — large heap allocation, risk of fragmentation failure. |

Per the codebase "no fallbacks" rule, architecture-dependent checks emit nothing when board data is missing rather than guessing.

---

## Advanced

### 1. Concurrent tasks over a single radio

The radio is one resource, but the cooperative state machine lets multiple async tasks share it without any of them blocking `loop()`. This is the canonical shape — a one-time network task, a cyclic polling task, and a heartbeat that keeps blinking regardless of network state:

```typescript
import { WiFi, Http, delay } from '@typecad/hal';
import { D2 } from '@typecad/board-esp32-devkit';

const led = D2.asOutput();

async function network() {
  await WiFi.connect("HomeNet", "hunter22");
  console.log(WiFi.localIP());
}

async function pollCloud() {
  while (true) {
    await WiFi.untilConnected(0);
    const req = Http.get("https://httpbin.org/get");
    await req.send();
    console.log(`${req.status()}`);
    await delay(5000);
  }
}

async function heartbeat() {
  while (true) { led.toggle(); await delay(500); }
}

network();
pollCloud();
heartbeat();
```

### 2. AP provisioning fallback

A common field pattern: try saved credentials; if they fail, fall back to an open AP so the user can supply new ones:

```typescript
import { WiFi } from '@typecad/hal';

if (!WiFi.connectSaved()) {
  WiFi.apChannel(6).apMaxClients(1);
  WiFi.startAP("device-setup"); // open AP
  console.log(WiFi.apIP());
}
```

### 3. Threading and memory notes

- The IDF event handler runs on the default event-loop task and updates volatile fields on the runtime struct; the application task reads them from `loop()`. There are no mutexes — transitions are monotonic from the polling side.
- HTTP responses are heap-capped by `maxBody()` (default 8 KB). Bodies are NUL-terminated and valid until the next `send()`; copy if you need to keep them.
- The app task stack is 16 KB (not the Arduino-classic 8 KB) because TLS handshake and WiFi event handlers overflow 8 KB and reboot with no useful panic line.
