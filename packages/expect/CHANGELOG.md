# @typecad/expect

## 1.0.0-alpha.16

### Patch Changes

- @typecad/hal@1.0.0-alpha.16

## 1.0.0-alpha.15

### Minor Changes

- fbd0820: Board and MCU packages are gone — replaced by SDK-derived, project-local board modules.
  
  The 18 hand-maintained packages (`@typecad/board-*`, `@typecad/mcu-*`) duplicated data the Zephyr tree already carries. They are deleted outright; no shims, no deprecation path. What replaces them:
  
  - **A generated board data pack** (`framework-zephyr/src/sdk/board-data.generated.ts`): 1311 board variants extracted from the pinned Zephyr 4.4 tree by a tolerant DTS reader — LED/BUTTON devicetree specs, console UART, connector gpio-maps — regenerated explicitly via `node scripts/gen-zephyr-board-data.mjs`.
  - **Consolidated soc descriptors** (`framework-zephyr/src/chips/soc/`): the nine validated SoCs' silicon facts (GPIO controller splits, ADC channel maps, PWM matrices, probe methods, custom-board inputs) in one registry keyed by SoC name, mechanically migrated from the package data by `scripts/gen-soc-descriptors.mjs` plus curated tier/naming/exclusion facts.
  - **boardgen** (`framework-zephyr/src/boardgen.ts`): joins a pack entry with its soc descriptor and emits `.cuttlefish/board.ts` (typed `Pin.fromPort` datasheet names, LED/BUTTON, connector labels, bus selectors) + `.cuttlefish/board.json` (the BoardConstants flat map, pin manifest, tier). Projects get both on first build; they are project-pinned and diffable.
  
  **Config shape:** `board:` is now a qualified Zephyr target (`'esp32s3_devkitc/esp32s3/procpu'`); `mcu:` is gone. Contract projects (custom PCBs) use `soc: 'stm32f411xe'` + `contract:` — the narrowed board and the soc's board.json generate from the registry. The scaffold wizard, `cuttlefish create` targets, and starter programs ride the same catalog (any of the 1311 targets; starters are thin-HAL).
  
  **Resolution:** `import { GPIO2 } from '@typecad/board'` resolves to the project-local generated module (a walk-up from the source file); chip resolution keys off the manifest's `zephyr.soc` into the soc registry. Hardware-verified end to end on the ESP32-S3 rig (WiFi/store/File+MQTT suites) with no board package anywhere in the tree.
- 0fc2d1f: ## HAL hardware suite follow-up: per-board configs, EEPROM removal, interrupt + validation fixes
  
  Follow-up to the Black Pill hardware-suite bring-up, driven by its findings:
  
  - **test(hal): per-board suite.** The package now mirrors the repo-root
    `tests/hardware` method: board-agnostic groups in `tests/` (bus singletons,
    `LED`/`A0`, numeric ambient calls) and pin-name-specific groups in
    `tests/boards/<board>/`, with one config per target selected via
    `cuttlefish-test --config` — `cuttlefish.config.ts` (Black Pill, default),
    `esp32-devkit.config.ts`, `uno.config.ts`. Scripts: `test:hw` (default),
    `test:hw:esp32`, `test:hw:uno`.
  - **fix(cuttlefish): capability lookups on sparse pin arrays.** `pins.all`
    is keyed by position but HAL pin numbers are sparse once a pad is unbonded
    (STM32F411 has no PB11, so PB12 = number 28 sits at index 27) — capability
    validation and pulldown validation read the WRONG pin's entry past the
    first gap. Lookups now resolve the entry by its `number` field
    (`pinEntryIndexForNumber`).
  - **fix(cuttlefish): board-constants flattener resolves same-file const
    references.** MCU capability objects declared once and referenced by every
    pin (`capabilities: GPIO_ANALOG`, `pwm: YES`, including spreads) flattened
    to nothing, so pin-capability validation rejected every pin on boards
    using the pattern.
  - **fix(framework-zephyr): attachInterrupt on ANY GPIO.** Interrupts were
    limited to pins with DT-spec entries (buttons); every other pin lowered to
    a silent comment no-op. Pins inside a declared controller range now attach
    through the raw-controller gpio_callback chain; only numbers no controller
    covers are flagged.
  - **fix(framework-zephyr): getPwmFrequency/Resolution agree with the
    constant fold.** The transpiler folds them to the MCU manifest's
    peripherals.pwm constants (Black Pill: 50 MHz / 16-bit) while the runtime
    lowering returned 1e9/period (50 Hz) and 8 — a folded literal and a
    runtime call disagreed. The lowering now prefers the declared constants.
  - **fix(cuttlefish): millis() link error under the async runtime.** The
    emitted shim's millis() definition was stripped when a program's only
    consumer is the injected static async runtime (Async.sleep lowers to a raw
    op the timing scanners can't see) — undefined reference at link time.
  - **feat(hal)!: EEPROM removed from the HAL.** Persistent storage goes
    through `Preferences` (ZMS-backed settings on Zephyr, NVS on ESP32,
    EEPROM-backed shim on AVR internally). The `EEPROM` class, its ambient
    declaration, lowering gating, and the hardware test are gone.
- b3d1c4b: ## HAL hardware suite consolidated onto board test-pins; framework expect suites removed
  
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
  
  ## USB port discovery for multi-board test rigs
  
  COM/tty numbers reshuffle on replug and on every CDC re-enumeration after a
  flash — a nightly test box with several boards cannot track them. Ports are
  now identified by USB VID/PID (+ optional serial number):
  
  - **feat(expect): USB identity port resolution.** `test.usb: { vid, pid,
    serial? }` in the config, or the same block in a board's test-pins.json
    (config wins), resolves the console/upload port via `serialport`'s
    listing. The runner **re-resolves after every upload**, so a CDC console
    that re-enumerates under a different COM number is found again; failures
    are loud and include the full attached-port table. `--port`/`test.port`
    always override (and a `--port` flag disables discovery). New
    `--discover` flag lists attached ports (VID:PID/serial/manufacturer),
    marks the active identity's match, and exits 1 when no unique match —
    a rig bring-up and CI gate in one.
  - **feat(boards): per-board Zephyr CDC PIDs.** Every Zephyr CDC console
    defaults to the Zephyr test IDs 2FE3:0001, making boards
    indistinguishable by USB. The blackpill/xiao/rp2040/rp2350 board
    packages now assign their own PID (2FE3:0002–:0005) via the existing
    zephyr.usb.vid/pid plumbing, mirrored by the `usb` block in all nine
    test-pins.json files (bridge boards carry their bridge chip's ID: Uno
    16U2 2341:0043, ESP32 DevKitC CP2102 10C4:EA60; the esp32c3/c6/s3
    entries assume the USB-Serial/JTAG console, unverified on hardware).
    All nine hal board configs now use `test.usb`, keeping their explicit
    port only as the bootstrap fallback for pre-PID firmware.
  
  Nightly-rig hardening (found by hammering the Black Pill 17 flash cycles
  in a row):
  
  - **fix(expect): mid-close serial errors no longer kill the process.** The
    reader's cleanup stripped ALL listeners before close() completed, so a
    USB dropout mid-close emitted an unhandled 'error' event and crashed
    Node — now a no-op error handler stays attached through close.
  - **feat(expect): transient-failure retry.** A USB console glitch mid-read
    loses the protocol lines (timeout, board fine) and debug-probe flashes
    occasionally fail target examination under repeated SWD cycles
    (OpenOCD "Failed to read memory at 0xe000ed04"). With a USB identity
    active, each file gets one fresh compile/upload/read cycle on such a
    failure — verified live: a timing-out file recovered on retry and the
    run went green. The resolved port is also re-checked before every
    upload, so a mid-run COM change never feeds a stale port to a bridge
    upload.
  
  ## fix(framework-zephyr): protocol numbers survive libc swaps (SDK 0.17.5)
  
  The 0.17.5 Zephyr SDK switched the libc from newlib to picolibc, whose
  default build silently prints NOTHING for `%g` — the same trap as
  newlib-nano without `-u _printf_float`. Every `[TC:EXPECT:<matcher>:<n>:]`
  protocol line arrived with an empty value and all hardware tests failed
  with `*float*` actuals. The expect shim's numeric helpers now format via a
  manual integer-only formatter (`__tc_fmt_num`: sign, `%lld` integer part,
  `%06lld` fraction with trailing-zero trim, NaN guard) — integer conversions
  work in every libc configuration, and the host parser accepts plain
  fixed-point. Regression-tested in shim-regressions (no %g/%f/%e in the
  emitted helpers) and verified on hardware: the 12/12-failing math group
  passes and the full Black Pill suite runs green again.
  
  - **fix(framework-zephyr): pulseIn's END wait is bounded by the timeout.**
    The pulse-measurement loop (`while (pin == value) {}`) had no deadline —
    a line idling at the target level spun forever, hanging the board (no
    SUITE_END, host timeout). The 0.17.5 SDK exposed it on the hardware
    suite: `INPUT_PULLUP` + `pulseIn(pin, 1)` now that pull configuration
    takes effect, so the pin reads HIGH, the bounded START wait exits
    instantly, and the old unbounded END loop hung. Both waits now share the
    caller's timeout, matching Arduino pulseIn semantics.

### Patch Changes

- ## The console.* carry-over is gone
  
  `console.log` no longer lowers to a platform print, and the `console` section
  of cuttlefish.config.ts (`baudRate`, `port`, `output`) is removed — including
  the never-published `console.output: 'usb'` CDC routing (overlay composition,
  kconfig USB forcing, and the SYS_INIT boot-with-DTR-wait). Programs write to
  a serial console explicitly: `USB0.writeLine(...)` (USB CDC) or
  `UART0.writeLine(...)` from the board module.
  
  Configs that still carry a `console` section warn and drop it, so existing
  projects keep building while told to delete the key. `console.*` calls in
  program source — statement and value position — fail compilation with a
  diagnostic that names the replacement instead of lowering to nothing.
  
  Ships with a dead-API sweep across cuttlefish, framework-zephyr, and expect
  (stale platform-strategy/toolchain-types surface, native and generic strategy
  slimming, unused type-inference paths, the expect config's console
  extraction).
- 5f587c7: PWM and ADC are back: silicon routes flow from the SoC pinctrl files.
  
  - DAC routes flow through the same pipeline (STM32 `dac1_out1_pa4`
    harvest → `zephyr.dac.channels` + per-pin `analogOutput` capability; the
    overlay enables the DAC node and wires the used channels' pinctrl groups,
    scanned from the emitted lazy-setup guards). Routes are cross-checked
    against SoC-declared devices — pinctrl files sometimes carry routes for
    peripherals the dtsi never defines (L4S5), and a route for an undeclared
    device would emit `DEVICE_DT_GET` against nothing. 106 boards carry
    device-backed DAC channels; verified end-to-end as a west compile.
  - Watchdog coverage jumped 675 → 891 boards: when the board DTS writes no
    `watchdog0` alias, the catalog falls back to the SoC-level watchdog node
    (STM32 `iwdg`, found through the include chain). Hardware-verified on
    the Black Pill's IWDG — the full suite passes 80/80 with the watchdog
    group (enable + feed) included.
  - The board catalog now also resolves SoC dtsi includes through the
    zephyr tree's arch dts roots (dts/arm, dts/xtensa, …), which is what
    makes the watchdog node visible. Absorbing SoC dtsis changed how the
    reader's `&label` overrides merge (into the real labeled node instead of
    a synthetic one) — bus facts now key off the recorded `refOverrides` set
    instead of node naming, preserving the board-wires-it-only rule.
  
  - The board-catalog walker now harvests silicon PWM/analog routes from the
    vendor HAL's per-SoC pinctrl dtsi (STM32 `tim4_ch1_pb6` / `adc1_in1_pa1`
    nodes; 226 boards gained facts on this tree), resolving module dts roots
    beside the zephyr checkout. The manifest generator maps them to global
    pins via the derived controller table (a pad on a port the board's facts
    never reference stays unexported — all boards equal), applies the
    `tim{N}` → `pwm{N}` convention, and emits `zephyr.pwm.specs` /
    `zephyr.adc.channels` with per-family timer clocks; per-pin capability
    flags (`analogInput`, `pwm`) are honest again. Families with matrix/
    arithmetic PWM (ESP32 LEDC, RP2040) or C-header pinctrl (Atmel SAM) are
    follow-up family conventions.
  - The PWM overlay enable was fixed for STM32: the SoC dtsi ships a
    label-less pwm child, so the overlay defines `pwmN: pwm` inside
    `&timersN` with the pad-routing pinctrl groups on the child (where the
    binding declares them) and the 16-bit prescaler on the parent.
  - The hardware suite's PWM and ADC groups run again, rewritten for the thin
    PWM/ADCChannel classes with new `adcPin`/`adcPinAlt` test-pin roles —
    hardware-verified on the Black Pill: the full suite passes 78/78 with zero
    skips (PWM construction/duty/pulse/period/tone through the harvested
    tim1 routes on PA8/PA9; two-channel ADC reads through the harvested
    adc1_in1/adc1_in2 groups on PA1/PA2).
  
  Hardware-test suite fixes for the shared default USB identity and the SWD flash cycle, plus the resurrected per-feature HAL hardware suite.
  
  - Restored the featureful HAL hardware suite (deleted in the workspace
    consolidation) under `packages/hal/tests/` — role-driven groups for GPIO
    modes/reads/interrupts, LED, SPI, timing, math, random, shift, interrupt
    control, UART, and I2C plus a wired loopback tier — adapted to the thin
    HAL classes (the ambient Pin/PWM/Preferences namespaces and bus singletons
    did not survive the rework). Pin choices live in the project's
    `test-pins.json`; PWM/ADC groups skip on boards without those facts.
    `npm run test:hw --workspace @typecad/hal` runs it (ST-Link flash, USB CDC
    console).
  - USB CDC identity is now always the Zephyr-test default `2FE3:0001` (per-board
    PID assignment is gone). The hal expect projects, the rig runner, and docs
    match the default; the rig runner treats the shared identity as claimed by
    the first CDC board that passes (a later CDC project failing on the same
    port is reported as skipped, not failed — use `--board <dir>` to be explicit).
  - `@typecad/expect` buildTarget resolution now mirrors the cuttlefish
    config-loader: `board:` is the source of truth; `frameworkData.buildTarget`
    is honored only for board-less projects.
  - Cuttlefish tree-shaking no longer drops typed-array buffers
    (`const id = new Uint8Array(4)`): HAL-op string fields are scanned for
    identifiers (spi.transceive's rx embeds the buffer name) and element-access
    assign targets contribute their base name. Typed-array buffers keep
    non-const storage (HAL fills write through them) — the ownership
    suggest-const pass skips them, and the split-mode extern uses the array form.
  - `west flash` via openocd now issues a post-flash SYSRESETREQ (direct AIRCR
    write): on ST-Link clones with flaky/unwired SRST, west's trailing `reset
    run` leaves the core halted in the flash stub — the app never booted and the
    USB CDC console stayed wedged (Windows SetCommState error 31 until replug).
    The system reset restarts the app and re-enumerates the console.
  - Board-catalog bus extraction classifies multi-function bus blocks by their
    `compatible` — Atmel SAM `sercomN` nodelabels carry no function, so every
    SAMD/SAM board previously extracted zero bus controllers (SPI0/UART0/I2C0
    unavailable errors). 35 boards gain buses.
  - The UART RX-ring shim no longer emits a `(void)dev;` statement at file scope
    (a syntax error whenever a thin UART port with rx ops was used).
  - The CDC device now presents a serial-number string descriptor sourced from
    hwinfo (CONFIG_HWINFO=y where USB is used). Without a serial, Windows keys
    the devnode on the physical USB port: flash-cycle re-enumerations reuse
    stale port-keyed nodes until one wedges into permanent "access denied"
    opens (no process holds the port — the driver state itself is stuck).
    Identity-based instance paths are stable across ports and immune to the
    port-keyed ghost pool. The console boot shim also holds the device
    disconnected ~2 s after start so the host fully processes each
    re-enumeration instead of reusing the node mid-removal.
  - openocd flashes now run through a dedicated probe session instead of
    `west flash`: halt at the reset vector, flash with `cortex_m maskisr`
    masked (the `cortex_m` command is PER-TARGET — addressed via
    `[lindex [target names] 0]`, and self-gating so non-Cortex-M cores skip
    it and fall back to openocd's generic reset), then boot the app with a
    direct SYSRESETREQ. Config resolution covers both the named probe
    method's catalog `debugCfg` and the board's own `support/openocd.cfg`
    from the Zephyr tree — so raw `zephyr.runner: 'openocd'` and probe
    methods without a debugCfg get the session too. `west flash` remains the
    fallback, with a post-failure SYSRESETREQ to clear any lockup for the
    caller's retry (a locked-up core is deterministic to recover: the
    failed flash detaches the console, which is exactly what makes the
    retry's flash pass).
  - The CDC console boot waits for a STABLE DTR (~200 ms continuously
    asserted) instead of the first edge — a failing host open attempt toggles
    DTR briefly, and printing into a port whose open never completes lost the
    first protocol groups.
  - The featureful suite now runs on the ESP32-S3 devkitC as a first-class board
    (`boards/esp32s3/` — console and esptool flashing through the CH34x bridge,
    DTR/RTS boot gating via resetAfterOpen; the UART group is excluded there —
    the board's single uart IS the protocol channel — and PWM/ADC/LED groups
    skip by role: no silicon matrices, no led0 node in the devicetree). A
    `test-pins.json` co-located with the board config wins over the project
    root, so multi-board projects keep one pins set per config; the shared GPIO
    group no longer requires the LED role for the same reason.
  - ESP32 family silicon now flows too: the LEDC PWM matrix (45 pads × 8
    channels on the S3, harvested from the `LEDC_CH<n>_GPIO<pin>` macros in
    the soc pinctrl header) and the SARADC channel map (GPIO1-10 = adc0
    CH0-9, from the HAL's `adc_channel.h`) — both shape-parsed C headers,
    with file paths keyed on the target's soc segment like the letter-port
    families. `PWM` and `ADCChannel` are exported through the narrowed
    gateway on ESP32 boards and hardware-verified on the devkitC (ADC read
    2148 counts on a floating GPIO1; LEDC construction + duty on a matrix
    pad).
  - `Counter` works, hardware-verified on both a probe-flashed and a
    bootloader-flashed board: the catalog harvests counter-capable nodes from
    the include chain (labeled RTC nodes carrying counter compatibles —
    nRF `rtc1:`, STM32 `rtc:` — and the unlabeled `counter {}` children
    under ESP32/Ambiq timer parents, whose labels the generated overlay
    defines), boardgen emits `zephyr.hwtimer.controllers` with a
    kernel-claim exclusion table (ESP32 esp_timer and nRF RTC0 belong to the
    system tick; STM32 SysTick means its RTC is free), and the overlay
    enables the nodes in both forms. 555 boards carry counter facts. The
    lowering was also fixed against the current counter API
    (`counter_set_top_value(dev, const counter_top_cfg*)` with a
    `(dev, user_data)` trampoline — the old 4-arg form no longer compiles),
    and the compile-time overlay usage scan learns the `counter_`/`__tc_hw`
    tokens (scaffold already scanned them; the compile-time regen did not,
    so the overlay enable never fired outside prepare).
  - The dead Pin surface is removed: `createPinGroup`/`IPinGroup`/
    `PinGroupMember` (hal), the `__tc_PinGroup` shim block, its
    `programUsesPinGroup` scanner, and the call-site rewrite (framework
    strategy), and the orphaned `gpioGroup` test-pins role. The `Pin` class
    keeps only its identity surface (`fromPort` — boardgen's constructor);
    the bus selector classes (`I2CBus`/`SPIBus`/`SerialPort`) keep only their
    identity + Sensor fact-carrier methods, as before.
  - The broken tier is cleared, hardware-verified on the Black Pill:
    `Store` (preferences/FS) works — the reader harvests the flash size
    (`DT_SIZE_K` in the flash@ node) and the manifest emits
    `zephyr.storage.{offset,size}` for boards whose DTS ships no
    `storage_partition`, arming the overlay's partition synthesis (569
    boards carry flash facts); `UART.println` works — the hal arg resolver
    returned string literals UNESCAPED, so any control-character argument
    (`"\n"`) emitted a raw newline that broke the C++ literal (all string
    args now route through the shared escape helper); free
    `attachInterrupt`/raw-pin interrupts work — the `interruptAttach`
    plugin was missing entirely (the call survived as an undefined C++
    function) and the raw-pin shim collector missed the call form that
    never becomes an IR op, leaving undefined `__tc_int_raw<N>_*` symbols.
    `Num.map` was a deliberate removal (documented in math.ts), not a gap.
  - The board module is now the NARROWED hardware gateway: it re-exports each
    hardware class from `@typecad/hal` only when the board's facts support it
    (Watchdog/PWM/ADCChannel/DACChannel/I2CTarget/SPITarget/UART/USBConsole
    conditional; GPIO/Thread/Time/Sensor always). User code imports hardware
    from `@typecad/board` — unavailable hardware fails at module resolution
    instead of a deep transpile diagnostic. The suite, rig tests, and the
    blackpill demo migrated; the ESP32-S3 rig test dropped its PWM/ADC
    usage (the LEDC/SARADC matrices are pending family conventions, so those
    classes are genuinely not exported there yet — the import now says so).
  - Maximality fixes in the manifest generator: harvested silicon routes now
    extend the derived GPIO controller table (the board's own DTS includes its
    PACKAGE-specific pinctrl file, so a route is the board declaring the pad —
    same board-equal standing as a led fact; previously a port no
    led/button/connector sat on exported nothing, dropping the blackpill's
    entire PB bank: 12 of 30 PWM routes and PB's ADC channels), and the
    port→global-pin mapping range-checks the controller's WIDTH instead of its
    global range (the old check silently dropped every route on any port after
    the first). The blackpill now exports its full 22 PWM-capable pads and all
    10 ADC channels; PB6's `tim4_ch1_pb6` route hardware-verified.
  - `Power.setCpuFrequency()` is removed entirely — it lowered to a comment
    (nRF52 fixed HFXO, "no portable scaling") while the API shape promised
    frequency control: every caller compiled green and got nothing. The op
    is gone from the hal class, the emit stub, the IR union/registry, the
    plugin lowering, the manifest, and its no-op-asserting host test.
    (`@register`/`@bits` were audited as dead and kept — they have a full,
    tested lowering to `volatile uint32_t*` + shift/mask through
    ir/register-decorators.ts; the audit claim was wrong.)
  - `Time.freeHeap()` is removed entirely — free heap is not a timing concern
    and the implementation was a constant-0 stub on every target.
  - `Time.nowUs()` lowers to uptime-derived microseconds uniformly on every
    board — the cycle-counter form reads a constant on SoCs without a
    free-running 64-bit counter (verified on ESP32-S3 hardware), and the
    framework keeps no SoC-conditional lowering paths. Resolution is the
    uptime tick (millisecond), uniformly.
  - The esptool port forwarding (`--esp-device`) and the bossac port
    forwarding/touch-reset are gated on the resolved flash RUNNER (the
    explicit choice or the board's declared default from its probe table),
    never on board names — any board whose flash runs a given runner is
    treated identically.
  - Serial opens retry for up to 12 s — a CDC port that just re-enumerated can
    be listed but not openable while Windows re-creates the device PDO — and a
    file may retry up to twice on transient console losses (the retry message
    now includes the cause).
  
  The JS-named timer polyfills are removed; periodic work is a Thread.
  
  - `setInterval`/`setTimeout`/`clearInterval`/`clearTimeout` are gone from the
    embedded surface end to end: the hal class methods, the IR ops and their
    union/registry entries, `POLYFILL_BACKED_OPS` (now empty — no op is
    polyfill-routed), the framework-zephyr lowering cases, the `timer_methods`
    polyfill (file + manifest + strategy wiring), the transpiler's arrow-hoist
    interception and `__tc_*` rename, the `timerCallCount` program-analysis
    counters, the ambient `declare function` declarations in config-loader and
    `cuttlefish create` templates, and the polyfill-helper-registry tokens.
    `usesTimers` in the emitter context now comes from the strategy's async
    config (`hasTimers`), which Zephyr declares false — periodic/deferred work
    is a `Thread` (`k_thread`) or a `Counter` (hardware timer). The native
    (host) framework keeps its real OS-backed timers, declared through its own
    `ambientTypeDeclarations` so only host projects see the names typed.
    Demos converted to the Thread idiom and verified to link on device
    toolchains: demo-timing (XIAO nRF52840), zephyr-ui, zephyr-weather,
    demo-shadcn (ESP32-S3). Host suites: 2249 green.
  - Ownership fix that the Thread idiom exposed: a top-level `let` mutated only
    inside an out-of-band callback body (Thread.start, watchPin, drawCanvas —
    statements that ride in `program.registeredCallbacks`, not a function
    body) was const-promoted and the emitted `const` made g++ reject the
    callback's assignment. The const-suggestion pass now enumerates
    registered-callback bodies (regression test included).
  - Every declared ADC controller contributes channels, not just the first:
    channel entries carry their owning controller (`zephyr.adc.channels.N.
    controller`, omitted on the primary so single-controller manifests are
    byte-identical), the lowering resolves the pin → (controller, channel)
    pair and addresses the right device handle (`__tc_adc_dev` stays the
    primary's; others get `__tc_adc_<label>_dev`), setup symbols are
    controller-qualified where channel indices collide, and the overlay
    enables each controller that owns a used channel (a controller left
    `disabled` in the SoC dtsi has no device instance — the read fails to
    link). The compile-time used-pin scan also learns the thin-ADC lazy-guard
    form (`__tc_adct<pin>_done`) — families without pinctrl groups (ESP32
    SARADC) never emit the setup-function call sites it used to scan.
    STM32 adc1/adc2 share pads, so routes dedupe per pad (primary wins) and
    those manifests are unchanged; on the ESP32-S3 the second SARADC unit's
    pads (GPIO11-20) become analog-capable and hardware-verified
    (`adcPinAlt` on GPIO11 reads through adc1 — the full devkitC suite
    passes 75/75 with 3 board-honest skips: uart, led, i2c — the devkitC
    wires no I2C controller, and 09-i2c now declares `@typecad-requires-roles
    i2cBus` so it skips by role instead of failing).
  - `Store`/`File` are gateway-gated on a storage region and the region is
    honest: boards whose DTS ships a `storage_partition` (ESP32's AMP layout)
    now carry its REAL reg (the reader harvests the partition node's
    offset/size; flash size also understands `DT_SIZE_M` and the
    `&flash0 { reg = … }` variant-module override form) with a
    `storage.preexisting` marker so the overlay writes only the `/chosen`
    pointer instead of redeclaring the node. `Store` roundtrips
    hardware-verified on the devkitC's own 192 KB partition.
  - `File` (littlefs on the storage partition) is hardware-verified on both
    boards (new `tests/common/19-fs.test.ts`): write/read/overwrite/exists/
    remove roundtrips. Three real bugs fixed on the way: `fs_read_text` now
    terminates at the READ length (the shared static buffer kept bytes from a
    longer previous file — a short read returned `"secondfs"`), the littlefs
    mount retry formats on ANY failure (littlefs reports `-EIO` on erased
    flash, not only `-ENODATA`/`-EINVAL`) and prints the failing rc, and
    `quoteNonIdentifier` no longer passes dotted text through as a C++
    expression — a field-tracked literal like `'a.txt'` lost its quotes and
    emitted bare (`'a' was not declared`); only single identifiers (runtime
    variables) pass unquoted now.
  - The esp32s3 test config carries `adcPin`/`adcPinAlt` (both SARADC units),
    `pwm`/`pwmAlt` (LEDC matrix — hardware-verified: construction, duty,
    pulse, period, tone on GPIO6/GPIO7), and the blackpill config's stale
    "PWM/ADC skip" note is corrected (silicon routes are harvested since the
    pinctrl work). `GENERATOR_REV` is 18.
  
  Three more false promises removed: Power, Worker, tone.
  
  - `Power` is gone entirely — `deep_sleep`/`light_sleep` were best-effort
    guesses over Zephyr PM policy (never hardware-verified), and
    `deepSleepUntil` hardcoded `DT_NODELABEL(gpio0)`, which only exists on
    nRF/ESP32 SoCs — on STM32 (gpioa/…) using it was a compile error, a raw
    nodelabel where a catalog fact belongs. The hal class, emit stubs, the
    IR ops, the plugin, the lowering, the manifest category, the
    CONFIG_PM/CONFIG_PM_DEVICE Kconfig emission (and its usage scan), and
    the shim/Kconfig tests are removed; the scaffold never enables PM now
    (regression-tested — nothing may key off `tx_power_dbm`'s substring).
  - Worker offload is gone — the ops, the shared runtime + polyfill, the
    isolation analyzer, the Zephyr k_work backing, the strategy hooks, the
    manifest category, and its tests were machinery with NO hal entry
    point: no class ever exposed a single worker op. `await worker.submit`
    joins the awaitable-op list's deleted members.
  - `PWM.tone()` is gone — square-wave sugar over one `pwm_set_dt`; a
    50%-duty `setDuty` at the right period does the same thing in user
    terms. Removed from the hal class + emit stub, the op/union/registry,
    the plugin, the pin-mode/capability validators, `usesTone` program
    analysis, the Zephyr lowering + pin-collector/diagnostic logic, the
    empty manifest `tone` category, and the simulator's mirroring
    `tone`/`noTone`/`stop` + `IToneAttachment`. The hardware PWM group
    drops its tone case (construction/duty/pulse/period remain).
  
  Dead PWM-getter plumbing removed; the hal docs now match the surface.
  
  - `pwm.get_frequency`/`pwm.get_resolution` were unreachable end to end: the
    ops, the lowering, the manifest declarations, the chip-descriptor
    `maxFrequencyHz`/`resolutionBits` facts, and the `pwmMaxFrequency`/
    `pwmResolutionBits` test-pin roles all fed a constant fold of
    `getPwmFrequency()`/`getPwmResolution()` — methods no hal class ever
    exposed (and boardgen emits no `peripherals.pwm.*` constants, so the
    descriptor fields were always empty on real boards). Removed with their
    tests, the orphaned `create/board-template.jsonc` (`cuttlefish board add`
    no longer exists), and the expect README's example that used them.
  - `packages/hal/README.md` was a fossil from the pre-rework surface
    (OutputPin/InputPin, createPinGroup, ADC/DAC singletons, HardwareTimer,
    Timer0-2, Preferences/FS/WDT/Power, delay/millis, `@typecad/mcu-*` /
    `board-*` packages). Rewritten to the real thin-class surface, the
    `@typecad/board` narrowed gateway, the real directives (`rawCpp`/
    `rawCppExpr`/`include`/`board`), working examples, and the current
    two-board hardware suite with its role-skip parity model.
  - `HAL-GUIDE.md` rewritten around the semantic-op pipeline (class facts →
    emit stub → plugin case → op → strategy lowering → manifest → board
    facts), with a real GPIO anatomy example, the new-peripheral checklist,
    and the current reference implementations; the old `emit()`-template
    walkthrough documented a directive and a file layout that no longer
    exist.
  - `README_FLUENT_API.md` rewritten to the two REAL chaining mechanisms:
    the `this` pattern (BleChain) and the `device()` factory (bus → device
    fact-carrier propagation). The old ToneChain intermediate-class example
    described a general name-matched field-propagation mechanism that was
    removed with the legacy surface — the doc now says so explicitly.
  
  Consistency enforcement: the hal's promises are now checked against its
  capability mechanically.
  
  - New `manifest-consistency` test validates the REAL framework-zephyr
    manifest against the REAL resolver (the exported validator was never
    invoked outside ad-hoc stubs): every 'supported' declaration must lower,
    every 'unsupported' one must not, and the conformance file list must
    match reality. The manifest's halResolutionTests list was completed to
    cover the snapshot files that existed unlisted (thread, wifi, usb,
    thin-buses, thin-classes); sensor stays unlisted until it gets a snapshot
    test.
  - Mechanical cross-check of the hal surface: 112 `emit.ts` stubs ↔ 112
    hal-plugin cases, exactly 1:1 in both directions — no method promises a
    lowering that doesn't exist, no plugin case is unreachable.
  - `noInterrupts()`/`interrupts()` were a silent no-op on every non-Cortex-M
    SoC: the shim gated `__disable_irq()` behind `#if defined(__CORTEX_M)`,
    so on the ESP32-S3 (Xtensa) and RISC-V targets the "globally disable
    interrupts" promise compiled to an empty function — and the hw test only
    asserted callability, passing vacuously. Now lowered to Zephyr's portable
    `irq_lock()`/`irq_unlock()` with a paired key (every arch), verified on
    the S3 on metal (5/5) and compile-checked on the Black Pill.
  
  Board bus singletons are the API: `UART0.println(...)` with no strings.
  
  - The board module's UART exports are FUNCTIONAL instances now
    (`export const UART0 = new UART('UART0')` instead of the method-less
    `SerialPort` identity carrier), and the transpiler registers the import
    as a full UART instance carrying the class defaults — so
    `UART0.println('hello')` / `UART0.write(...)` / `UART0.available()` work
    directly, no construction, no port-name strings, no foreknowledge of
    controller naming. A board without the controller simply does not export
    the name (the narrowed gateway, unchanged). `SerialPort` is removed
    entirely — `UART` absorbs it; the simulator's unrelated host-side
    `ISerialPort` contract stays.
  - Explicit construction remains for non-default facts and now accepts the
    board instance in place of the name: `new UART(UART0, { baud: 9600 })`,
    `new I2CTarget(I2C0, 0x44)`, `new SPITarget(SPI0, PA4)` — the
    constructor capture dereferences a known bus instance to its controller
    identity (this instance-arg path already existed; the suite now
    exercises it). The string forms still work.
  - The hardware UART group leads with the direct-singleton idiom; docs
    (hal README example + surface table) show the direct form first.
    Verified end-to-end as a linked Black Pill firmware
    (`UART0.println` + `new I2CTarget(I2C0, 0x44)` lowering to
    `__tc_uart0_dev` poll-out and `__tc_i2c0_dev` register verbs).
  
  All peripheral singletons are the API now — `bus.device(...)` hands back a
  functional target.
  
  - `I2C0.device(0x44)` and `SPI0.device(PA4)` return the FUNCTIONAL
    `I2CTarget`/`SPITarget` directly — register/transceive verbs callable
    with zero further construction (`I2C0.device(0x44).writeReg(...)`), and
    the same object is the fact-carrier `new Sensor(...)` consumes. The
    standalone `I2CDevice`/`SPIDevice` identity classes are deleted (absorbed
    by the targets, which carry the same facts plus the verbs;
    `I2CTarget` gains the `address` getter that kept the simulator's
    `II2CDeviceAccessor` contract satisfied). Every factory path in the
    transpiler (receiver-chain, alias-chain, statement capture, and the
    Sensor constructor arg resolver) now produces/consumes the target
    classes AND carries their wire defaults (`_hz`, SPI `_mode`) — without
    those, an inlined `this._hz` leaked raw text into the op and the plugin
    rejected it. Verified as a linked Black Pill firmware: direct
    `UART0.println`, `I2C0.device(0x44).writeReg/readReg/updateReg`, a
    Sensor constructed through `I2C0.device(0x44)`, and
    `SPI0.device(PA4).transceive(buf)/readReg` all lower to the right
    `__tc_*_dev` calls; the sensor demo still transpiles and the i2c/spi
    hardware groups dry-run clean.
  - Latent Zephyr compile bug exposed on the way: `needsVectorOverload()` was
    true on a target with no `<ostream>`/`std::vector` — any program whose
    analysis touched vector-ish types (a typed-array buffer) while calling
    console.log emitted a `std::ostream& operator<<` helper that could never
    compile. Zephyr now declares it false (console output is the
    printf-based `__tc_print` helpers).
  
  - String literals interpolate into HAL calls again: interpolating a string
    variable into a HAL call template (`UART0.println(\`${s}34\`)`) emitted
    `.c_str()` on a variable the
    declaration renderer had already lowered to `const char*` (Zephyr maps
    std::string away) — a guaranteed compile error. The HAL-body snprintf
    builder now normalizes the IR scope's type through the active strategy
    before the char* check, matching what the declaration emitted; plain
    literals, number interpolations, and console.log templates were already
    correct. Regression-tested (string-literal-interpolation.test.ts) and
    proven as a linked Black Pill firmware.
  
  - Interpolating a double-returning HAL call or a float literal into a HAL
    call template (`USB0.writeLine(\`ticks: ${Time.now()}\`)`) formatted as
    `%d` — a -Wformat warning on every Zephyr build — and float LITERALS took
    an AVR-only `dtostrf` detour that cannot compile elsewhere. Both now
    format as `%g` (the same portable choice the float-variable branch had
    already made); the inline-call detection keys on the lowerings'
    deterministic `static_cast<double>(...)` shape.
- fbd0820: Legacy-HAL removal — **Phase 1b: framework-arduino and the AVR path are deleted.** This retires the "frozen Arduino" surface; the repository is Zephyr (+ native desktop simulator) only.
  
  **Deleted packages**:
  - `@typecad/framework-arduino` — the ArduinoStrategy, Adafruit display/touch adapters, arduino-cli compile/upload integration, AVR profiles, doctor. Its published npm artifacts remain installable for old projects.
  - `mcu-atmega328p`, `board-arduino-uno` — AVR silicon has no Zephyr port; the Uno/pro-mini hardware story ends here.
  
  **Deleted demos** (frozen-Arduino targets): ble-demo, demo-display, demo-pro-mini, demo-safety, demo-st, demo-ui, demo-ui-sd13, demo-weather, rmt-demo. Their thin-Zephyr counterparts exist (zephyr-display/zephyr-ui/zephyr-weather/zephyr-blink family) or are covered by the hal rig.
  
  **Deleted test surface**: ~150 test files whose assertions were specifically about the removed Arduino lowerings (transpileArduino/AVR/ESP32 helpers, uno wiring, Arduino manifest/avr-profile suites) — they tested deleted behavior and die with it. Remaining verified battery: 3228 passing across 314 files after cleanup, including the full framework-zephyr directory, compliance, manifests, expect dry-runs, and token sync.
  
  **Test harness**: `tests/setup.ts` + `tests/setup-framework.ts` now register `ZephyrStrategy` as the default loaded framework; the deleted transpileArduino/transpileAVR/transpileESP32 helpers are gone. The boardConstants injection for board-derived chip resolution was re-applied (it briefly vanished with the setup restore).
  
  **Deferred deliberately**: `@typecad/arduino-cli` package remains — @typecad/expect's host compiler imports its env-check helper; unwrapping that dependency is a small follow-up before it too can go. Root README/docs mentions of Arduino are Phase-4 documentation work.
- fbd0820: Fixed: `npx cuttlefish-test` found zero test files when run from a nested suite directory.
  
  `npm exec` resets the spawned command's working directory to the npm *local prefix* — the nearest ancestor with a `package.json`. From a hardware suite dir like `packages/framework-zephyr/hal/esp32s3` (which deliberately has no `package.json` of its own), that lands on the workspace package instead of the project under test, so the CLI's `process.cwd()`-based project root resolved the wrong directory and test discovery came back empty (which previously made a direct `node …/dist/host/cli.js` invocation the only working option). The CLI now resolves the project root through `INIT_CWD` — the directory npm records as the real invocation dir — falling back to `process.cwd()` when it's unset or missing.
  
  The hardware runner (`hal/run.mjs`) repins `INIT_CWD` to the suite dir when spawning the CLI, so `npm run hal` on a board package (which sets `INIT_CWD` to the *board package* dir for the whole process tree) keeps resolving the suite it actually targets.
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [5f587c7]
- Updated dependencies [fbd0820]
- Updated dependencies [0fc2d1f]
- Updated dependencies [b3d1c4b]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [a9bcb6e]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
  - @typecad/hal@1.0.0-alpha.15

## 1.0.0-alpha.14

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
  - @typecad/arduino-cli@1.0.0-alpha.14
  - @typecad/hal@1.0.0-alpha.14

## 1.0.0-alpha.13

### Patch Changes

- @typecad/hal@1.0.0-alpha.13
- @typecad/arduino-cli@1.0.0-alpha.13

## Unreleased

- **Dropped `output.optimize` from the config re-emitter.** The hw-test
  runner's mini config parser read `output.optimize` from
  `cuttlefish.config.ts` and copied it into the generated test config —
  dead weight now that the key is removed from cuttlefish (no framework
  ever consumed it). Old configs carrying the key are simply ignored here.

## 1.0.0-alpha.12

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
  - @typecad/arduino-cli@1.0.0-alpha.12
  - @typecad/hal@1.0.0-alpha.12

## 1.0.0-alpha.11

### Patch Changes

- @typecad/arduino-cli@1.0.0-alpha.11

## 1.0.0-alpha.10

### Patch Changes

- @typecad/arduino-cli@1.0.0-alpha.10

## 1.0.0-alpha.9

### Patch Changes

- @typecad/arduino-cli@1.0.0-alpha.9

## 1.0.0-alpha.8

### Patch Changes

- @typecad/arduino-cli@1.0.0-alpha.8

## 1.0.0-alpha.7

### Patch Changes

- @typecad/arduino-cli@1.0.0-alpha.7

## 1.0.0-alpha.6

### Patch Changes

- Updated dependencies
  - @typecad/arduino-cli@1.0.0-alpha.6

## 1.0.0-alpha.5

## 1.0.0-alpha.4

### Minor Changes

- ## cuttlefish licenses + doctor: license compliance auditing

  New CLI commands for environment verification and license compliance auditing of
  Arduino dependencies.

  ### `cuttlefish licenses [--all] [--strict]` (new)

  Audits the SPDX licenses of the Arduino libraries a project depends on, with
  copyleft risk classification. Resolves each library's license from
  `library.properties` → `LICENSE` file → source-header comment, normalized via a
  static SPDX table (MIT, BSD-2/3, Apache-2.0, LGPL-2.1/3.0, GPL-2.0/3.0,
  AGPL-3.0, Unlicense, CC-BY/SA/NC-4.0, including `-only`/`-or-later` variants).

  **Project-scoped by default.** Resolves the project's library set from the
  generated `.ino`'s `#include` directives (authoritative — exactly what
  arduino-cli links), with a config-derived display/touch fallback when no `.ino`
  exists. `--all` restores system-wide scanning of every installed library.

  **Four-layer header resolution** (project scope), in order:

  1. User libraries (`arduino-cli lib list`) → resolved with license
  2. Core-bundled libraries (the project's own board core, derived from the FQBN
     via `arduino-cli config dump`) → resolved with license (e.g. `Wire` →
     `LGPL-2.1`, read from its header notice)
  3. Toolchain headers (`avr/*.h`, `util/*.h` from avr-libc) → gray
     `CORE/TOOLCHAIN` row, not flagged as missing
  4. Not installed → red `NOT INSTALLED` (the actionable missing-dependency case)

  Output sorts worst-first: strong copyleft `[COPYLEFT]`, weak copyleft
  `[weak copyleft]`, permissive `✓`, then unknown `UNKNOWN`. `--strict` exits
  non-zero on unknown licenses or missing dependencies (CI-enforceable).

  ### `cuttlefish doctor` (new)

  Verifies `arduino-cli` is installed and the board core for the configured
  `buildTarget` (FQBN) is present, with the exact `arduino-cli core install`
  command to fix a missing core.

  ### Resolver + detection improvements

  - **Library name normalization**: bare import specifiers with underscores
    (`Adafruit_ILI9341`) now correctly resolve to libraries whose arduino-cli
    name uses spaces (`Adafruit ILI9341`), instead of falling back to a
    PascalCase header guess. Fixes `licenses` falsely reporting libraries as
    not-installed.
  - **Broadened license detection** for real-world Arduino libraries: British
    `LICENCE.txt` spelling, `LICENSE` under `src/`, source-header comment scanning
    (the Adafruit pattern), short-form markers (`BSD license`, `Apache License`),
    and the `SPDX-License-Identifier:` marker with `-only`/`-or-later` suffixes.
  - **Project-local header exclusion**: headers co-located with the `.ino`
    (cuttlefish-emitted polyfills) are recognized as project code, not missing
    libraries.

### Patch Changes

- Updated dependencies
  - @typecad/arduino-cli@1.0.0-alpha.4

## 1.0.0-alpha.3

### Minor Changes

- ## framework-avr: full bare-metal framework

  The `@typecad/framework-avr` package is now a complete, production-ready
  framework for native AVR register-level code generation. It went from an
  unmaintained stub to a fully-featured framework at parity with
  `@typecad/framework-arduino`.

  ### Native register lowering (55 HAL ops)

  Every hardware peripheral is lowered to direct register access — no HAL op
  falls through to Arduino Wiring calls:

  - **GPIO** (PORT/DDR/PIN), **PWM** (OCRnx), **ADC** (ADMUX/ADCSRA)
  - **Timing** (Timer0 overflow ISR + fractional millis), **Interrupts** (EICRA/EIMSK)
  - **Tone** (Timer2 CTC + GPIO toggle), **Pulse/Shift** (micros + GPIO loops)
  - **SPI** (SPCR/SPSR/SPDR), **UART** (USART0), **I2C/TWI** (TWBR/TWCR/TWDR)
  - **EEPROM** (avr-libc `eeprom_read_byte`/`eeprom_write_byte`)

  ### Chip-descriptor portability

  Pin/register mapping is data-driven via `AVRChipDescriptor`. ATmega328P
  (Arduino Uno/Nano) and ATmega2560 (Arduino Mega 2560) descriptors included.
  Adding a chip is a data file, not strategy code.

  ### Bare-metal main() — 72% Flash reduction

  Defining `int main(void)` prevents the Arduino core from being linked,
  yielding dramatically smaller binaries:

  - Minimal pin toggle: **198 bytes** (vs 712 bytes with framework-arduino)
  - Demo (pins + I2C + SPI + timers): **724 bytes** (vs 2.5 KB)

  ### Pluggable OutputShim in @typecad/expect

  The test framework now accepts a pluggable output shim instead of
  hardcoding `Serial.print`. framework-avr provides `avrUartShim` that
  routes test protocol through native `_uart_*` helpers, so test builds
  are fully bare-metal too.

  ### Additional changes across packages

  - `@typecad/cuttlefish`: added `filterRequiredIncludes()` to
    `PlatformStrategy` so frameworks can strip stale HAL includes
  - `@typecad/expect`: `OutputShim` interface, `serialShim`/`avrUartShim`
    built-ins, `ResolvedConfig.framework` field threaded through config
  - All packages: version-aligned at 0.1.0-alpha.3

## 0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Initial publication of the TypeCAD package suite.
