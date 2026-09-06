# Networking (WiFi, HTTP, MQTT)

TypeCAD exposes the radio and the network clients as thin classes: construction carries the whole configuration (credentials, security, timeouts, broker URIs), and every method lowers 1:1 onto Zephyr's native networking — `wifi_mgmt`/`net_mgmt` for the link, `http_client` over sockets for HTTP/S, and the Zephyr MQTT client for pub/sub. There is no Arduino layer and no runtime session object: the construction facts ride each generated call.

Calls work in three styles: **blocking** at the top level, **event-callback** (`onUp`/`onDrop`) for fire-and-forget programs, and **`async`/`await`** for cooperative multi-task programs (the awaited ops split into a non-blocking start + poll). A compile-time validator flags HTTP/MQTT usage in a program that never brings a WiFi link up.

---

## WiFi

`WiFi` is a *link policy*: `new WiFi(ssid, opts)` captures credentials, security, band/channel, join deadline, power-save, and (optionally) static IPv4. `join()` lowers those facts onto `wifi_connect_req_params` and then waits — bounded by `timeoutMs` — for the L4 connected flag (raised after DHCP, or immediately when static IPv4 facts are configured).

```typescript
import { WiFi } from '@typecad/hal';
import { UART0 } from '@typecad/board';

const wifi = new WiFi('HomeNet', { psk: 'hunter22', timeoutMs: 30000 });
if (wifi.join()) {
  UART0.writeLine(`up at ${wifi.ip()} (${wifi.rssi()} dBm)`);
}
```

`psk` omitted → open network. `security` defaults to WPA2 when a psk is present, OPEN otherwise; override with the `WiFi.OPEN` / `WiFi.WPA2` / `WiFi.WPA3` / `WiFi.WPA2_WPA3` tokens.

### Static IPv4 and power save

Both are construction facts:

```typescript
import { WiFi } from '@typecad/hal';

const lab = new WiFi('LabNet', {
  psk: 'hunter22',
  ipv4: { addr: '10.0.0.5', gateway: '10.0.0.1', netmask: '255.255.255.0' },
  powerSave: WiFi.PS_OFF,   // disable modem sleep for lower latency
  channel: 6,               // 0/omitted = any
  band: WiFi.BAND_2_4,
});
```

### Async / cooperative join

`await wifi.join()` (statement position) lowers to a non-blocking **start + poll** pair: the association is armed, then the async state machine polls `linked()` each driver-loop tick until it flips or the deadline lapses. Other tasks keep running while the station associates:

```typescript
import { WiFi, Time } from '@typecad/hal';

const wifi = new WiFi('HomeNet', { psk: 'hunter22' });

async function network() {
  wifi.joinStart();                       // fire-and-forget
  while (!wifi.linked()) { await Time.sleep(100); }
  UART0.writeLine(wifi.ip());
}
```

### Event-callback style

```typescript
wifi.onUp(() => UART0.writeLine(`online at ${wifi.ip()}`));
wifi.onDrop(() => UART0.writeLine('link lost'));   // deferred off the event chain — safe to call join() in it
wifi.join();
```

### Scanning

`scan()` performs one blocking scan and returns a read-only handle over a fixed 16-entry pool (no heap). Inside an async function, `await wifi.scan()` splits into scan-start + scan-done polling.

```typescript
const results = wifi.scan();
for (let i = 0; i < results.count(); i++) {
  UART0.writeLine(`${results.ssid(i)}  ${results.rssi(i)} dBm  ch${results.channel(i)}  ${results.security(i)}`);
}
```

### SoftAP

`WiFiAP` carries the AP facts the same way — `start()`/`stop()` map to `NET_REQUEST_WIFI_AP_ENABLE/DISABLE`:

```typescript
import { WiFiAP } from '@typecad/hal';

const ap = new WiFiAP('cuttlefish-setup', { psk: 'config123', channel: 6 });
ap.start();
// ... provisioning ...
ap.stop();
```

---

## HTTP — `Request`

`Request` is the single-slot HTTP/S client. Construction carries the method, URL, timeout, body, and TLS policy; `header()` chains request headers; `send()` performs the request over Zephyr sockets (DNS → connect → `http_client_req`). Response state lives in the client slot until the next `send()`.

```typescript
import { Request } from '@typecad/hal';

const req = new Request('GET', 'http://192.168.2.184:8080/health');
req.header('X-Device', 'cuttlefish');
if (req.send()) {
  UART0.writeLine(req.status());              // 200
  UART0.writeLine(req.ok());                  // true when 2xx
  UART0.writeLine(req.text());                // body, valid until the next send()
  UART0.writeLine(req.responseHeader('Content-Type'));
}
```

Method statics (`Request.GET/POST/PUT/DELETE/HEAD/PATCH`) and chaining read naturally:

```typescript
import { Request } from '@typecad/hal';

new Request(Request.POST, 'http://api.local/telemetry', {
  body: '{"temp":21.5}',
  json: true,                             // sets Content-Type: application/json
  timeoutMs: 5000,
}).header('Authorization', 'Bearer x').send();
```

### TLS / HTTPS

HTTPS is native (mbedTLS over TLS sockets). The CA policy is a construction fact:

```typescript
import { Request } from '@typecad/hal';

// Pin a specific CA (a private CA, for example). The PEM literal is decoded
// to DER at BUILD time — no PEM parser ships on the target.
const pinned = new Request(Request.GET, 'https://internal.corp/api', { caCert: '...PEM...' });

// Self-signed lab endpoint: encrypt but skip verification (development only).
const pinnedLab = new Request(Request.GET, 'https://lab-server.local', { insecure: true });
```

Don't ship `insecure: true` in production firmware.

### Async send

Inside an `async function`, `await req.send()` (statement position) splits into send-start + done-polling, so a slow request never stalls the rest of the program:

```typescript
import { Request, Time } from '@typecad/hal';

async function pollCloud() {
  while (true) {
    const req = new Request(Request.GET, 'http://api.local/health');
    await req.send();
    UART0.writeLine(req.status());
    await Time.sleep(5000);
  }
}
```

The construction facts (headers, body, TLS) lower as the segment's leading statements; only the send itself splits. Value-position awaits (`const ok = await req.send()`) fall back to the blocking form — use statement position for the cooperative split.

---

## MQTT — `Mqtt`

`Mqtt` is the single-slot MQTT 3.1.1 client over Zephyr's MQTT library. Construction carries the broker URI and client id:

```typescript
import { Mqtt } from '@typecad/hal';

const mqtt = new Mqtt('mqtt://192.168.2.184:1883', { clientId: 'sensor-01' });
mqtt.onMessage((topic, payload) => UART0.writeLine(`${topic}: ${payload}`));
mqtt.connect();
mqtt.subscribe('sensors/#');
mqtt.publish('sensors/room/temp', '21.5');
// …
mqtt.close();
```

- **URIs**: `mqtt://host:port` (plain TCP, default 1883) and `mqtts://host:port` (TLS, default 8883). Hostnames resolve through Zephyr's DNS resolver; numeric IPs resolve directly.
- **`connect()` returns void** — the Zephyr client completes its session (CONNACK) in a background poll thread that also owns keepalives and QoS-1 acks. Poll `linked()` afterwards; on a flaky link, retry `connect()` in a loop until `linked()` flips.
- **QoS**: subscriptions and publishes ride QoS 1 (at-least-once) — the shim acks incoming QoS-1 publishes so the broker doesn't resend.
- **Payloads**: topic and payload arrive as NUL-terminated C strings valid until the next message — copy what you need inside the handler.
- **`mqtts://`** is encrypted but currently **verification-free** (the HAL surface has no CA-pinning op for MQTT yet — the analogue of Request's `caCert`). A future CA fact will flip it to verified TLS like the HTTPS path.

The compile-time validator treats MQTT like HTTP: using `Mqtt` in a program that never brings a WiFi link up is flagged before you flash.

---

## API Reference

### WiFi

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new WiFi(ssid, opts?)` | `WiFi` | Link policy: `psk`, `security`, `channel`, `band`, `timeoutMs` (default 15 s), `powerSave`, `ipv4 {addr, gateway, netmask}`. |
| `join()` | `boolean` | Associate and wait for IP connectivity (bounded by `timeoutMs`). Awaitable (start + poll). |
| `joinStart()` | `void` | Fire-and-forget associate — poll `linked()`. |
| `leave()` | `void` | Disassociate (`NET_REQUEST_WIFI_DISCONNECT`). |
| `linked()` | `boolean` | True once IP connectivity is up. |
| `rssi()` / `ip()` / `mac()` | `number` / `string` / `number` | Link info (`ip()` is `"0.0.0.0"` when down). |
| `onUp(fn)` / `onDrop(fn)` | `void` | L4 up / down callbacks (drop is deferred — safe to re-join from it). |
| `scan()` | `Scan` | One blocking scan; read through the handle. Awaitable. |

### Scan

| Member | Returns | Description |
| :--- | :--- | :--- |
| `count()` | `number` | Networks found (fixed pool of 16). |
| `ssid(i)` / `rssi(i)` / `channel(i)` | `string` / `number` / `number` | Per-result fields (`ssid` is `""` when out of range). |
| `security(i)` | `string` | `"open"` / `"wpa"` / `"wpa2"` / `"wpa3"`. |

### WiFiAP

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new WiFiAP(ssid, opts?)` | `WiFiAP` | AP facts: `psk` (omitted → open), `channel` (0 = auto). |
| `start()` / `stop()` | `void` | Bring the AP up / down. |

### Request

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new Request(method, url, opts?)` | `Request` | `timeoutMs` (default 10 s), `body`, `json`, `insecure`, `caCert` (PEM literal, DER-decoded at build time). |
| `Request.GET/POST/PUT/DELETE/HEAD/PATCH` | `string` | Method tokens. |
| `header(name, value)` | `this` | Attach a request header; chainable. |
| `send()` | `boolean` | Perform the request (true when it completed). Awaitable (send-start + done poll). |
| `status()` / `ok()` | `number` / `boolean` | Response status / 2xx check. |
| `text()` | `string` | Response body (valid until the next send). |
| `contentLength()` | `number` | Response Content-Length (0 when absent). |
| `responseHeader(name)` | `string` | One response header (`""` when absent). |

### Mqtt

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new Mqtt(uri, opts)` | `Mqtt` | `mqtt://` / `mqtts://` broker URI; `clientId` (required). |
| `connect()` | `void` | Open the session (CONNACK completes in the poll thread — poll `linked()`). |
| `onMessage(fn)` | `void` | Handler for every received publish on subscribed topics. |
| `subscribe(filter)` | `void` | Subscribe to a topic filter (`"sensors/#"`). |
| `publish(topic, data)` | `void` | Publish (QoS 1). |
| `linked()` | `boolean` | True while the broker session is up. |
| `close()` | `void` | Disconnect and free the client. |

---

## Compile-time checks

- **Networking without a link**: a program that issues HTTP requests or MQTT connects but never constructs/joins a WiFi link (or starts an AP) gets an error diagnostic before flashing — every request would fail at runtime.
- **Statement-position awaits**: value-position awaits (`const ok = await req.send()`) cannot suspend mid-expression and fall back to the blocking shim; the cooperative forms require statement position.

## Advanced

- The link is managed by Zephyr's connection manager (`wifi_mgmt` + `net_mgmt` L4 events); `linked()` reflects the L4 flag, so static-IPv4 configurations come up without DHCP.
- Both clients are single-slot: a second `Request`/`Mqtt` instance reuses the same shim state (the last construction wins). One request/session at a time — pipeline in your program logic, not in the HAL.
- Broker hostnames need the DNS resolver; it is enabled automatically with the MQTT block.
