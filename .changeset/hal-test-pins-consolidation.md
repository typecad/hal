---
'@typecad/cuttlefish': minor
'@typecad/expect': minor
'@typecad/hal': minor
'@typecad/framework-arduino': minor
'@typecad/framework-zephyr': minor
'@typecad/mcu-nrf52840': minor
'@typecad/board-arduino-uno': minor
'@typecad/board-blackpill-f411ce': minor
'@typecad/board-esp32-devkit': minor
'@typecad/board-esp32c3': minor
'@typecad/board-esp32c6': minor
'@typecad/board-esp32s3': minor
'@typecad/board-rp2040': minor
'@typecad/board-rp2350': minor
'@typecad/board-xiao-nrf52840': minor
---

## HAL hardware suite consolidated onto board test-pins; framework expect suites removed

The expect-based hardware suites outside `@typecad/hal` are gone, and the
HAL suite is now one shared set of tests parameterized by each board:

- **feat(expect): `@typecad/test-pins` role module.** Board packages ship a
  declarative `test-pins.json` (pin roles — gpioOut/gpioIn/gpioGroup/pwm/
  pwmAlt/cs/interrupt/led/button — plus numeric facts like
  pwmMaxFrequency/pwmResolutionBits/adcMax). Test files import role names
  from `'@typecad/test-pins'`; the expect preprocessor substitutes each role
  with the configured board's real pin symbol (facts become numeric
  literals) and rewrites the import to `'@typecad/board'` — the exact
  lowering path hand-written per-board tests use. Files gate themselves on
  board capabilities with `// @typecad-requires-roles ...` and are skipped
  with a clear reason when the board's JSON lacks a role. Editor support:
  cuttlefish writes a `.cuttlefish/test-pins.ts` re-export beside
  `board.ts` and the scaffolded tsconfig maps the specifier.
- **test(hal): shared suite replaces per-board copies.** The six
  `tests/boards/<board>/{01-gpio,10-spi}.test.ts` copies (~95% identical)
  are now `tests/board/{01-gpio,02-pwm,10-spi,11-led}.test.ts` written
  against roles, plus a `tests/wired/` opt-in loopback tier (jumper
  gpioOut→gpioIn). Board-agnostic groups moved to `tests/common/`; the
  numeric-API constants group is now `@typecad-only-target stm32f411`
  (raw pin numbers 1–3 are only safe on the Black Pill's port-block
  scheme — on the ESP32 they are UART0, the protocol channel itself). The
  esp32-devkit group pins were fixed to pins the package actually exports
  (D6–D11 are flash-wired and unexported — the old copy was unrunnable).
- **test(hal): network suites relocated.** `tests/hardware/` (HTTP/MQTT/BLE
  on-metal clients + host server) moved to `packages/hal/tests/network/`
  — they exercise `@typecad/hal` client APIs and belong with the HAL
  suite. Root scripts `test:http` / `test:hw:http` / `test:ble` /
  `test:hw:ble` updated.
- **test: framework expect suites removed.** `framework-arduino/tests/`
  (~470 its), `framework-native/tests/` (~246 its + native vitest runner),
  and `framework-zephyr/tests/` (19 its) are deleted; their manifests no
  longer list hardwareTestGroups. The HAL suite already runs through both
  frameworks on metal (uno → framework-arduino, blackpill/esp32-devkit →
  framework-zephyr). Note: the native pipeline was the only automated
  C++-execution tier in CI — language-semantics coverage now rests on the
  emit-shape suites in `tests/` plus the HAL hardware runs.
- **feat(boards): `npm run hal` in every board package.** Each of the nine
  board packages gained a `hal` script that runs the shared HAL suite
  against its config in `packages/hal/boards/` (uno, blackpill, esp32-devkit,
  xiao-nrf52840 verified against chip descriptors; esp32c3/c6/s3, rp2040,
  rp2350 are best-effort configs for boards without hardware in this
  workspace). Simplified scripts: root `test:hw` now targets only the HAL
  suite; per-board `test:hw:esp32`/`test:hw:uno` variants removed in favor
  of `npm run hal` / `test:hw:board -- --config boards/<board>.config.ts`.
- **test(host): compile gate + contract validation.**
  `hal-hardware-test-compile.test.ts` now covers common/ + board/ + wired/
  through the same substitution path the hardware runner uses and asserts
  no role name survives into the emitted C++; a new
  `hal-test-pins.test.ts` validates every board's test-pins.json against
  the package's actual exports (following `export *` chains) and every
  config's include patterns against real directories.
- **test(hal): every board dry-runs clean.** All eight remaining board
  configs were verified with `cuttlefish-test --dry-run` (transpile + full
  toolchain compile, no hardware). The sweep caught and fixed one real
  cross-board bug (`pinMode(7, INPUT_PULLDOWN)` in the pulse group — AVR
  cores do not declare `INPUT_PULLDOWN`; now `INPUT_PULLUP`), split the
  channel-numbered `ADC.read(n)` API into `common/12-adc-channels.test.ts`
  (`@typecad-only-target avr, stm32f411` — the Zephyr lowering validates
  the numeric argument as a GPIO number), and encoded known board-bridge
  gaps as `@typecad-skip-target` directives with removal instructions:
  esp32/esp32s3 lack SPI/UART/I2C DT mappings, all four ESP32 board
  packages map no ADC channels, esp32c3/c6/s3 declare no DT watchdog node,
  and rpi_pico/pico2 define no `storage_partition` for the Preferences
  backend.

## Follow-up: board parity — every skip that was implementable is implemented

The dry-run gap table above has been closed. All eight board configs now
compile the full shared suite minus only hard hardware limits:

- **feat(framework-zephyr): bus-controller pinctrl synthesis.** Controllers
  whose board DT ships no default pinctrl group can now carry one as data
  (`zephyr.uart.controllers[].pinctrl: { include, pinmux, inputPinmux }`):
  the overlay generator emits the group under `&pinctrl`, splices the
  pinmux header, and wires `pinctrl-0`/`pinctrl-names` when enabling the
  controller. First use: rpi_pico/pico2 uart1 (GP8/GP9 and GP22/GP23 —
  the RP2350's UART1 ALT mux has no GP8/GP9 option), which un-skips the
  uart group on both Picos.
- **feat(boards: esp32 family): bus + ADC + wdt chip data.** esp32-devkit
  and esp32s3 now declare i2c/spi/uart controllers (UART instances map to
  the non-console uart1/uart2 so exercising them never reconfigures the
  protocol console) plus ADC1 channel maps and the wdt0 node; esp32c3/c6
  gain ADC1 channel maps and the wdt0 node. Un-skips i2c, spi, uart, adc,
  and wdt groups across the family.
- **feat(framework-zephyr): ADC.read(channel) channel-number fallback.**
  The adc.read argument serves both `InputPin.readAnalog()` (a GPIO
  number) and the Arduino-compat `ADC.read(channel)` (a channel number).
  Resolution is pin-first (readAnalog unchanged), then by channel index —
  `ADC.read(0)` now resolves on targets where channel 0 is not GPIO 0
  (XIAO AIN0 = P0.02, ESP32 CH0 = GPIO36). The 12-adc-channels group
  dropped its target scope accordingly.
- **feat(boards): rp storage partitions + PWM, xiao PWM, rp LED aliases.**
  rpi_pico/pico2 synthesize a storage_partition (top 512 KB of 2 MB /
  top 1 MB of 4 MB) — the preferences group compiles on both Picos. Both
  Picos declare a synthesized PWM spec on GP25 (slice 4B = channel 9, the
  only pad the board DT pins) via the existing controller+channel overlay
  path; the XIAO exports `PWM_LED = P0_17` (the pwm-led0 DT spec, 2 MHz /
  16-bit facts) — the pwm group runs on all three boards. Both Picos
  export `LED = GP25` (the onboard LED, reserved pad) and carry the led
  role.
- **test(hal): constants group made portable.** `pinMode`/`digitalWrite`/
  `shiftOut` accept pin symbols in numeric argument positions (the
  transpiler resolves them), so the numeric-API smokes now use test-pin
  roles instead of raw pin numbers and the stm32f411-only scope is gone.

Remaining skips are documented hardware limits (see the HAL README's
"Board parity" section): the uart group on AVR (the single hardware UART is
the protocol channel itself — no second UART, no USB console) and the led
group on the ESP32-C3/C6/S3 dev boards (WS2812 addressable RGB, not a plain
GPIO LED — those packages export no led role).

Parity round two (fixes surfaced by the first full dry-run pass):

- **feat(framework-zephyr): `pinctrlRef`, `props`, and `defines` on bus
  controllers.** Controllers can reference an EXISTING pinctrl group the
  board DTS defines but never attaches (esp32s3's uart1_default), carry raw
  property lines for bindings with required properties the board only sets
  on its own nodes (`current-speed` for the Picos' PL011 UARTs and the
  ESP32-S3's uart1), and inject ifndef-guarded `#define`s ahead of the
  pinctrl include — working around an upstream Zephyr bug where the rp2350
  pinctrl headers define the UART1 tokens against
  `RP2_PINCTRL_GPIO_FUNC_UART_ALT`, which is defined nowhere (mainline
  never consumes those tokens). Defined as AUX funcsel 11 per the datasheet.
- **feat(cuttlefish): PinDefinitions allows extra named pins.** Boards can
  tag additional named pins in their BoardDefinition (snake_case keys
  register the UPPER_SNAKE identifier in the pin alias map) — first use:
  the XIAO's `pwm_led: 'P0.17'`, exposing `PWM_LED` for the pwm-led0 DT
  spec pin that the curated MCU export set omitted (P0.17 added to
  mcu-nrf52840's manifest and pin exports).
- **fix(framework-zephyr): synthesized storage partitions declare their
  cells.** The overlay's `partitions` node now carries
  `compatible = "fixed-partitions"` + 1/1 cells explicitly — boards whose
  DTS already has a partitions node merged identically, but boards without
  one (rpi_pico2) hit dtc's spec default of 2/1 cells and rejected the
  2-cell reg ("length 8 not divisible by 12").

With this round, all eight board configs compile the full shared suite
(`cuttlefish-test --dry-run`): uno, esp32-devkit, xiao-nrf52840, esp32c3,
esp32c6, esp32s3, rp2040, rp2350 — plus the Black Pill's 95-test hardware
pass. The only skips left are the documented hardware limits above.
