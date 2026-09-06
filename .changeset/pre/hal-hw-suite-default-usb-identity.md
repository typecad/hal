---
"@typecad/expect": patch
"@typecad/cuttlefish": patch
"@typecad/framework-zephyr": patch
"@typecad/hal": patch
---

PWM and ADC are back: silicon routes flow from the SoC pinctrl files.

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
