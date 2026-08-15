# @typecad/ui

## 1.0.0-alpha.12

### Patch Changes

- Fixed two emitted-runtime compile errors that broke every Arduino UI build
  using the PSRAM canvas allocator (e.g. `demo-display`):
  - `ui_create_canvas_best`'s PSRAM debug `printf` lines emitted a literal
    newline inside the C++ string literal (the `\n` in the runtime-header
    slice's template literal was a JS escape, not the two C++ characters) —
    "missing terminating \" character". Now escaped as `\\n`.
  - `ui_draw_node_body` took a `const UINodeDrawCtx*` parameter, but the
    Arduino `.ino` preprocessor auto-inserts a forward declaration of every
    function near the top of the sketch — before the struct is defined — so
    the generated prototype failed with "'UINodeDrawCtx' does not name a
    type". The parameter is now `const void*` (cast back inside), keeping the
    auto-generated prototype primitive-only and valid.

### Minor Changes

- ## Display integration wizard (`npx @typecad/ui --config`)

  Installing `@typecad/ui` used to leave a gap: integrating a display requires
  choosing hardware (panel, bus, pins, speed, touch) and writing the
  `display` section of `cuttlefish.config.ts` by hand. The package now ships a
  `typecad-ui` bin, so the flow after `npm install @typecad/ui` is:

  ```bash
  npx @typecad/ui --config
  ```

  ### What it does

  - **Display selection** with hardware-aware defaults: the built-in profiles
    (`ili9341-spi`, `st7796-spi`, `ssd1309-i2c`), the desktop SDL simulator, or a
    fully custom driver (name, bus, resolution, color format).
  - **Bus wiring questions** — SPI (CS/DC/RST/backlight, frequency in MHz,
    optional SCK/MOSI/MISO override) or I2C (address, optional reset pin),
    prefilled from any existing `display` section on re-runs.
  - **Orientation + rendering** — rotation, antialiasing, and an advanced color
    branch (color order / inversion). ST7796S keeps the demos' proven `bgr` +
    non-inverted defaults.
  - **Touch** — none, resistive (XPT2046 / STMPE610 / 4-wire analog), capacitive
    (FT6336U / GT911 / CST816S), or a custom adapter file, each with its pins,
    I2C address/speed, IRQ/reset, and calibration (raw-ADC defaults for
    resistive, native-panel pixel space for capacitive — matching the demos).
  - **Theme hooks** — optional `themeCss` / `themeClass`.

  ### How it writes the config

  The `display` section is spliced into `cuttlefish.config.ts` through the
  TypeScript AST: only that section changes, every other section and its
  comments survive byte-for-byte, unmanaged display keys (`scroll`,
  `scanlineSync`, …) are carried over, and the edited file is syntax-checked
  before anything is written. GPIO collisions between display and touch wiring
  warn before the write. If the config's `entry` points at a missing `.ui`
  file, the wizard offers a documented-syntax starter screen, then prints the
  exact `arduino-cli lib install` (with the real Library Manager names —
  `RAK14014-FT6336U` for FT6336U, the ST7735/ST7789 fork note for ST7796S),
  preview, compile, and flash commands.

  No config yet → the wizard points at `npx @typecad/cuttlefish init` first.
  Non-interactive stdin → a clear error instead of a hang. `--help` / `--version`
  included; unknown flags exit 2.

  ### Internals

  New `src/wizard/` module (prompts, display/touch catalog, AST config writer,
  starter template) exported as `@typecad/ui/wizard` for reuse and tests;
  runtime deps added: `chalk` and `typescript` (both already present via the
  cuttlefish peer). `tests/packages/ui/integration-wizard.test.ts` covers the
  catalog, rendering, splice cases (insert / replace / CRLF / comma-and-comment
  handling), pin-conflict detection, the starter template, and a round-trip
  through cuttlefish's real `parseConfigFile` proving wizard output loads the
  same way the build loads it.

### Patch Changes

- ## Standalone-install dependency fixes

  Declared the dependencies each package actually consumes at build/test time,
  so installs outside the monorepo resolve without relying on hoisting:

  - **`@typecad/expect`** now declares `@typecad/hal` (a hard dependency — the
    test harness generates `cuttlefish.config.ts` files whose
    `import type { CuttlefishConfig } from '@typecad/hal'` previously failed to
    typecheck in standalone installs) and `@typecad/framework-zephyr` as an
    optional dependency (the `west build`/`west flash` compile path requires it
    dynamically and degrades gracefully when absent).
  - **`@typecad/cuttlefish`** now declares `@typecad/expect` as an optional
    dependency — `transpile.ts` loads its preprocessor and `cli-utils.ts`
    resolves the `cuttlefish-test` CLI from it, both with existing fallbacks.
  - **`@typecad/ui`** moved `@typecad/cuttlefish` from peerDependencies to
    regular dependencies (it is imported throughout `src/`), so installing
    `@typecad/ui` pulls the transpiler automatically like every other consumer.
  - **`@typecad/safety`** dropped its duplicate peerDependencies block —
    `@typecad/cuttlefish` and `@typecad/hal` were declared in both
    `dependencies` and `peerDependencies`; the regular dependencies (the pattern
    every other package uses) are kept.

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.12

## 1.0.0-alpha.11

### Patch Changes

- Updated dependencies [46f25f2]
  - @typecad/cuttlefish@1.0.0-alpha.11

## 1.0.0-alpha.10

### Patch Changes

- Updated dependencies [c7ea1b5]
  - @typecad/cuttlefish@1.0.0-alpha.10

## 1.0.0-alpha.9

### Patch Changes

- Updated dependencies [a27476a]
  - @typecad/cuttlefish@1.0.0-alpha.9

## 1.0.0-alpha.8

### Patch Changes

- @typecad/cuttlefish@1.0.0-alpha.8

## 1.0.0-alpha.7

### Patch Changes

- 0320018: ## ESP32: BLE, WiFi/HTTP, RMT, native display + touch, ESP-IDF v6

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

- Updated dependencies [0320018]
  - @typecad/cuttlefish@1.0.0-alpha.7

## 1.0.0-alpha.6

### Patch Changes

- @typecad/cuttlefish@1.0.0-alpha.6

## 1.0.0-alpha.5

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.5

## 1.0.0-alpha.4

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.4

## 1.0.0-alpha.3

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Initial publication of the TypeCAD package suite.
