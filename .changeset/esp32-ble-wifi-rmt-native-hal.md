---
"@typecad/framework-esp32": minor
"@typecad/cuttlefish": minor
"@typecad/hal": minor
"@typecad/framework-arduino": patch
"@typecad/framework-avr": patch
"@typecad/ui": patch
---

## ESP32: BLE, WiFi/HTTP, RMT, native display + touch, ESP-IDF v6

The ESP32 framework is now a first-class code-generation target alongside the
AVR and Arduino cores, with native ESP-IDF lowering across every HAL category.

### BLE peripheral (NimBLE)

- Full GATT peripheral lowering via NimBLE: `ble.server(name)`,
  `.characteristic(uuid, type, perm)`, `.onRead()/.onWrite()/.onConnect()/
  onDisconnect()`, `.notify()`, `.set_tx_power()`.
- Supports 16-bit SIG UUIDs, custom 128-bit UUIDs, and all read-value types
  (numeric, UTF-8, raw bytes). Auto-creates a default service when
  characteristics have no explicit parent.
- Async `ble.until_connected()` split lowers to a non-blocking poll state.
- `Preferences` backed by native NVS lowering (reads/writes persist across
  reboots); `Power.deepSleepPin()` pin-wakeup.

### WiFi + HTTP client (native, async)

- Native WiFi HAL with async lowering: `WiFi.connect()` lowers to start + poll
  states so a heartbeat loop keeps running while the link comes up. AP mode,
  tx power, channel, max clients, and client-count queries.
- HTTP client (`http.get/post`, async, HTTPS-insecure) end-to-end lowering with
  brownout-recovery fixes. Includes a hardware-test harness
  (`npm run test:http` + `test:hw:http`) and a compiled-output regression
  corpus (`demos/wifi-demo/out-samples`).

### RMT (ESP32-S3 onboard WS2812)

- `rmt.*` HAL-op IR + ergonomic stubs + `hal/rmt.ts` wrapper. IR-scanning init
  lines + per-op lowering, wired into dispatch with forced `esp_driver_*`
  CMake deps. MSB-first `txInit` for WS2812. Drives the ESP32-S3 onboard RGB.

### Native display + touch adapters

- Native ESP32 SPI display adapters (ILI9341, ST7796, SSD1309) and touch
  adapters (XPT2046, STMPE610, GT911, CST816S, FT6336U) with PSRAM + rendering
  fixes. License attribution headers added to touch adapters (NOTICE updated).

### ESP-IDF v6 migration

- `framework-esp32` migrated to ESP-IDF v6 public APIs: NimBLE API + callback
  fixes, removed deprecated `esp_nimble_hci`/`esp_ble_tx_power_set`, volatile
  `++` replaced with `+ 1` for GCC 13+ `-Werror=volatile`. Compiles clean on
  v6 (`idf.py build` passes).

### Bug fixes

- ownership-analysis: const-array demotion now fires for value-arg mutating
  methods lowered via `__RAW_STMT__` (e.g. `arr.push()` on a `const` binding no
  longer emits a non-compiling `const std::vector` + `push_back`).
- framework-avr: the UART driver shim is kept alive for `console.*` programs,
  since the AVR console polyfill routes `console.log` through `_uart_*` symbols
  (previously emitted an undefined-symbol link error).
