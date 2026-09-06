---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

Thin HAL wave 5: FS/Mqtt/Power thinned, four Zephyr-unsupported families cut, and the async tier's silent hal-op drop fixed.

- **`File` replaces `FS`**: `new File(path)` with `read()/write()/exists()/remove()` — construction is the whole configuration; the old `fs.begin()` mount session is gone (littlefs mounts lazily on first use). Verified on hardware (ESP32-S3): write → read → exists → remove round-trip plus a cross-flash marker surviving reflashes.
- **`Mqtt` thinned**: `new Mqtt('mqtt://host:1883', { clientId })` with `connect()/onMessage()/subscribe()/publish()/linked()/close()`. The client completes its session in a background poll thread (CONNACK wait, keepalive, QoS-1 acks); `connect()` returns void and `linked()` polls. Verified against the test server's Aedes broker on hardware: connect → subscribe → publish → loop-back through `onMessage`.
- **Fixed: MQTT connect failed with `gai=-2` on numeric-IP brokers.** The shim passed an *uninitialized* `port_str` buffer to `zsock_getaddrinfo`; Zephyr's literal-address parser rejects a service string whose parsed port is outside 1–65535 with `EAI_NONAME` — the same code as a name-resolution failure. The port string is now built with `snprintk` (as the HTTP shim always did). MQTT kconfig also enables `CONFIG_DNS_RESOLVER` so hostname brokers resolve.
- **`Power` thinned**: `deepSleep(ms)`, `deepSleepUntil(pin, level)`, `lightSleep()`, `setCpuFrequency(mhz)` as verbs on a stateless class (`PowerDefault` exported).
- **Cut (no Zephyr backing):** `Capacitive`, `Temperature`, `Mdns`, `Ota` classes, their stubs, plugin cases, op kinds, manifest categories, and probe payloads. Also removed the dead `wifiScanStart`/`delayMs`/`getMillis` stub chain.
- **Fixed: async functions dropped hal-op statements before an `await`.** A chained HAL call (e.g. `new Request('GET', url).header(...).send()`) lowers to a *block* of hal-ops; inside an async function the single-line statement renderer emitted a literal `{` for it — unbalancing the braces and silently discarding every op in the block. Blocks now render their body. Sentinel ops (absent body, `insecure: false`, no CA) elide silently instead of emitting `/* unhandled hal-op */` placeholders and bogus "not registered" warnings, and the no-CA path no longer prints "PEM failed to decode" on every plain-HTTP request.
- **Async-tier drift repaired:** `AWAITABLE_HAL_OPS` listed op names that no longer exist (`wifi.connect`, `wifi.wait_connected`, `ble.until_connected`) while missing the real `wifi.join`; `await wifi.join()` now gets the proper start/poll split instead of a blocking fallback. `wifi.scan_start` is restored as an internal split op (the shim helper existed; the lowering arm had been cut) so awaited scans start without blocking.
