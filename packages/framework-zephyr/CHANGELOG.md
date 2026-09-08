# @typecad/framework-zephyr

## 1.0.0-alpha.17

### Minor Changes

- The user-visible rename: `cuttlefish` → `typecad-hal` everywhere a user
  looks. Generated C++ (`CUTTLEFISH_*` macros, the `cuttlefish,` devicetree
  compatible, `cuttlefish-gfx`, user-facts markers) keeps the engine codename
  by design; the `@typecad/cuttlefish` engine package keeps its name (it
  appears only in lockfiles now).
  
  - The single binary is `typecad-hal`, hosted on `@typecad/hal`
    (`npx @typecad/hal create`); the engine ships no bins. Hardware tests run
    via `typecad-hal test`.
  - Project artifacts rename cleanly: `typecad-hal.config.ts`,
    `typecad-hal-env.d.ts`, `typecad-hal.facts.json`, `.typecad-hal/`,
    `typecad-hal.library.json`, `TYPECAD_HAL_*` env vars. Configs import
    `TypecadConfig` from `@typecad/hal/config`; the `@typecad/board` legacy
    alias is removed.
  - CLI banner/help, editor task labels + problem-matcher owners, the debug
    extension's activation trigger, the library npm marker keyword
    (`typecad-hal-library`), the SDL window title, USB descriptors, and
    sidecar tool ids all drop the codename. The machine-local board catalog
    migrates from `.cuttlefish/` by copy (no rebuild race).
  - West builds spawned through a PATH/venv west now pin
    `ZEPHYR_SDK_INSTALL_DIR` to the installer's SDK — Zephyr's CMake can no
    longer latch onto a stray older SDK in `$HOME` and fail at configure time
    (found on hardware: ST-Link + blackpill, SDK 1.0.1 pinned vs a stray
    0.17.4).
- Consolidate the package graph: expect and simulator dissolve into hal + the engine.
  
  - The engine no longer depends on `@typecad/hal` — HAL sources and the
    board-gate lists resolve from the project's own hal install
    (`TYPECAD_HAL_DIR` overrides), with a lockstep version warning on skew.
    `@typecad/hal` now depends on `@typecad/cuttlefish` (the product composes
    the engine); `@typecad/framework-zephyr` drops its hal dependency.
  - The hardware-test DSL ships in hal (`@typecad/hal/testing`); the host
    runner is built into the CLI (`cuttlefish test`, `cuttlefish-test` alias)
    and resolves the build framework from the project config instead of
    hardcoding framework-zephyr.
  - The simulator ships in hal (`@typecad/hal/sim`); a device build importing
    it fails with a pointing diagnostic.
  - Board-gate export lists are derived (index exports minus `GATED_EXPORTS`)
    instead of hand-maintained; new hal value exports self-classify.
  - Scaffolds list exactly `@typecad/hal` + the framework at the engine's own
    version (no more stale hardcoded ranges, and the `undefined` dependency
    bug fails loudly at scaffold time).

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.17

## 1.0.0-alpha.16

### Patch Changes

- debug: launch.json no longer bakes the generating machine's checkout path into GDB commands. `set directories <absolute workspace path>` became `set directories .` and the gdb frame-filter `source` line became app-relative — cortex-debug spawns GDB with cwd from the config's `cwd` field (`${workspaceFolder}`), so relative paths resolve to the same directory the absolute form named, on every machine and every checkout location. (A `${workspaceFolder}` literal in these command strings was not an option: cortex-debug does no variable expansion in postAttachCommands, and on Windows the expansion would carry backslashes GDB reads as escape sequences.) Tool paths (gdbPath/serverpath) stay absolute on purpose — they are machine-local SDK facts, rewritten by the first `--debug` build on each machine.
- zephyr: the deterministic openocd probe session now runs on Linux too. Its binary discovery previously checked only the Zephyr-SDK layout (`<sdk>/hosttools/openocd/bin`), so setups where openocd comes from `$OPENOCD` or PATH (a micromamba-env openocd is the common Linux case — the same binary west's own runner spawns) silently skipped the session and dropped every flash to the racy `west flash` fallback. Resolution now mirrors west: `$OPENOCD` → SDK-hosted (with its script search dirs) → PATH. Additionally, a failed openocd flash whose output carries a known target-ignored-SWD signature ("unable to connect to the target" — the DPIDR read never succeeded — or "timed out while waiting for target halted" / "Not halted") now prints a recovery pointer: power-cycle the board, replug the probe, or skip SWD entirely with `--probe dfu`. Those signatures usually mean marginal wiring, a low-power/locked core, or a wedged probe — not a toolchain bug.
- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.16
  - @typecad/hal@1.0.0-alpha.16

## 1.0.0-alpha.15

### Minor Changes

- a9bcb6e: ## F5 debugging for the STM32 Black Pill
  
  `blackpill_f411ce*` targets now select native GDB debugging (`debugMode`
  previously granted it only to ESP32-S3 boards, so `cuttlefish create`
  silently skipped the F5 launch config and VS Code asked for a debug profile
  instead). The Black Pill's ST-Link probe method ships in its board package —
  openocd runner over SWD with the `reset_config none` quirk for the unwired
  SRST line — and the generated artifacts now use it: a cortex-debug attach
  config, a build+flash preLaunch task, and a probe-method-driven
  `.cuttlefish/openocd.cfg`.
  
  The SDK GDB resolver is also architecture-aware now: ARM boards resolve
  `arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb` from the Zephyr SDK (from the
  build's CMakeCache or the discovered SDK roots) instead of the hardcoded
  ESP32-S3 Xtensa path, so the starter `launch.json` carries a working
  `gdbPath` on first open. `npm run sync:typecad-ui` additionally regenerates
  debug artifacts for the monorepo's demos, healing hand-assembled ones that
  never went through `cuttlefish create`.
- fbd0820: BLE GATT joins the thin HAL — the Arduino-bluedroid-style Ble singleton is
  replaced by a fact-first peripheral.
  
  The new `BLE(name)` carries the advertised identity at construction; the GATT
  database is declared through `service()/char()` chains (each char's
  uuid/type/perms ride its add op — the per-file declaration counter assigns
  indices), handlers attach with onRead/onWrite right where the characteristic
  is declared, and `notify(index, value)` pushes by declaration order.
  `start()` registers the deferred service table + bt_enable + advertises;
  `stop()/linked()/clients()/onConnect()/onDrop()` map 1:1 onto the bt_*
  surface. The GATT catalog (GATT.ENVIRONMENTAL…) stays as reference data.
  Removed: the Ble/BleServer singletons, BleStatus/BleAdvertisingMode enums,
  and 5 op kinds end-to-end (status, until_connected, until_connected_start,
  set_name, set_tx_power — all either unsupported or subsumed).
  
  Five real firmware bugs fixed on the way to hardware green, all in the
  Zephyr GATT shim:
  - **No CCC descriptors were emitted** — a central could never subscribe and
    notifications had nowhere to land. The table builder now appends a managed
    CCC (bt_gatt_ccc_managed_user_data with a no-op cfg_changed) after each
    notify characteristic.
  - **utf8 reads were UB**: hoisted string callbacks return std::string by
    value; the dispatcher called them through a const char* fn pointer and
    strung strlen over garbage. It now calls through the true signature and
    borrows c_str() for the copy.
  - **NULL-conn notify asserted the ESP32 controller** (lld_con.c 3327):
    bt_gatt_notify(NULL, …) on the first push after subscription crashes the
    S3 link layer. Notify now uses the stored active connection and no-ops
    when the link is down.
  - **notify() keyed off the shim's current_char** — wrong target for any
    standalone push after later declarations. The lowering now uses the op's
    declaration index (the shim's val_attr_idx table).
  - **BlePerm token expressions resolved as numbers** (always 0) — the plugin
    case now reads the token text that resolveBlePermExpr maps.
  
  The two-terminal hardware suite is restored from history and ported:
  `packages/hal/tests/network/ble-client.ts` (host noble central; scan window
  widened + discovery retry for Windows noble flakiness) against
  `ble-peripheral.test.ts` (now the thin API) — discovery, connect, five typed
  reads incl. utf8 and 128-bit UUIDs, write round-trip, subscribe+notify, and
  clean disconnect. Verified GREEN twice consecutively on the ESP32-S3: the
  peripheral's 6 asserts + SUITE_END over a raw serial capture, and the
  central's 12 checks — `npm run test:hw:ble:full` drives the pipeline
  (dry-run build → west flash → serial-watch → central). The in-harness
  serial reader proved DTR-flaky on the CH34x-bridged S3 and is bypassed by
  the orchestrator's raw watcher.
- 5f587c7: ## Board catalog syncs from your own Zephyr tree
  
  Board support no longer waits on a cuttlefish release. The tree walker that
  generates the compiled-in board data pack moved into `@typecad/framework-zephyr`
  (`src/sdk/catalog-walker.ts`) so it can run anywhere, and a new command
  regenerates the catalog from the Zephyr checkout you actually build with:
  
  - **`cuttlefish board sync [zephyr-base]`** — walks `<zephyr>/boards`, reading
    every variant's board DTS (LED/button devicetree specs, connector gpio-maps,
    pwm-leds, ws2812 strips), `board.yml` (both the multi-board `boards:` format
    and legacy single-board format), and `board.cmake` runner tables, then
    writes a local catalog overlay to `<workspace>/.cuttlefish/board-catalog.json`
    and prints what changed vs the built-in pack (added/changed/removed). It
    also regenerates the current project's board module so the sync lands
    immediately.
  - **`cuttlefish board regen`** auto-refreshes a stale overlay first — after
    `west update` (which moves the tree's git HEAD/VERSION) or after a
    framework update (the overlay's `generatorRev` no longer matches), a plain
    regen picks up the tree's boards. The walk only happens when work is needed.
  - All catalog lookups prefer the overlay: board generation (`boardgen`), the
    `cuttlefish create` wizard's board search, and `--board` target resolution.
    The overlay replaces (not merges with) the compiled-in pack.
  - `scripts/gen-zephyr-board-data.mjs` is a thin wrapper over the same walker,
    so the shipped pack and local overlays come from identical logic.
  
  ## Curated board layer removed — every board resolves the same way
  
  The hand-curated silicon layer is gone. There are no curated boards, no
  curated soc descriptors, no board overrides, and no validated/derived tier:
  `chips/soc/`, `chips/xiao-ble.ts`, `chips/esp32*.ts`,
  `chips/board-overrides.ts`, the `chipForSoc`/`chipForTarget` registry, the
  `DEFAULT_CHIP` (XIAO) fallback, and the create flow's curated nine target
  entries / bare-MCU (`--mcu`) targets are all deleted.
  
  Every board now resolves through one path:
  
  - **boardgen** derives a GPIO controller table from the controller names in
    the board's own devicetree facts (vendor-family port conventions), sweeps
    every derived range into datasheet-named pins, and emits bus instances
    (`zephyr.i2c/spi/uart.controllers.*`), the USB device controller
    (`zephyr.usb.*` — present only when the board's DTS enables it), the
    watchdog (`zephyr.wdt.nodeLabel` — the devicetree watchdog0 alias), LED/
    button dtSpecs, and the board's own `board.cmake` probe table — all from
    the catalog record.
  - **The strategy** reconstructs its chip view solely via
    `resolveChipFromBoard` over the generated manifest; unresolved boards stay
    `NO_BOARD_CHIP` and each subsystem reports unsupported. WiFi/HTTP/MQTT
    availability is family-derived from the soc name (esp32* has the radio).
  - **Strap-pin exclusions are gone** — every pad sweeps like any other.
    Silicon facts that never live in devicetree (per-pin ADC channels, PWM
    matrices, DAC) are absent for every board alike; programs using them on a
    board whose DTS does not wire them now get honest diagnostics instead of
    silently-wrong lowering.
  
  Removed with the layer: Zephyr bare-silicon/contract projects
  (`soc:` configs and `cuttlefish create --mcu`) — their entire
  implementation was the curated soc registry. Use a board target from the
  catalog. Test fixtures now build their chip views through the same
  `generateBoard` → `resolveChipFromBoard` path products use, augmenting with
  explicitly-synthetic silicon fields where lowering logic needs inputs that
  devicetree cannot provide.
  
  ## Walker fixes found during randomized verification
  
  Three randomized hand-verification rounds (~40 boards checked against their
  actual DTS/yaml/cmake sources) drove these extraction fixes, each with
  regression tests:
  
  - **board.yml qualification by key ownership** — the old
    "collect every soc in the file" heuristic silently dropped every board in
    a multi-board directory (the Zephyr 4.x `boards:` list format) and
    qualified `qemu_x86_lakemont` with another entry's soc. 31 boards
    recovered; runner args and includes now parse per-variant by matching the
    `CONFIG_BOARD_<name>` / `CONFIG_SOC_<soc>_<qual>` guard each target
    belongs to (first-wins where no guard matches).
  - **Vendor-flavored runner includes** map to their real methods
    (`openocd-stm32`, `openocd-nrf5` → openocd; `esp32` → esptool), and the
    full west flasher set is covered (stm32cubeprogrammer, nrfutil, uf2,
    silabs_commander, probe-rs, rfp, bflb_mcu_tool, xsdb, wchisp, spsdk,
    minichlink, mdb-hw, wlink, gd32isp, sftool, teensy, nulink — all
    flash-only). CMake-variable args (`${CONFIG_SOC}`) are dropped. Runners a
    board guards behind another core's config are not offered to that target.
  - **Comment handling** — a comment line inside a node no longer hides the
    property after it; comma-style gpio-map comments (`/* Pin 1, LEDK */`)
    yield real net-name labels instead of truncated garbage.
  - **Duplicate runner includes** no longer mint duplicate probe methods.
  - **Canonical LED/button follow the devicetree numbering** — the
    `led0`/`sw0`-aliased node is canonical, so `LED<N>`/`BUTTON<N>` manifest
    aliases match dtSpec numbering on every board.
  
  
  ## The static board database is gone — regen is the mechanism
  
  The 102k-line compiled-in board pack (`board-catalog.generated.ts`) is
  deleted, along with the repo-side generator script. There is exactly one
  catalog source: the user's own Zephyr tree.
  
  - **Catalog tooling moved into cuttlefish** (`src/board-catalog/`): the
    tolerant DTS reader, the tree walker, the overlay store, and fs-only tree
    discovery, exported as `@typecad/cuttlefish/board-catalog`. The create
    wizard uses it before any framework is installed; framework-zephyr
    consumes it and adds the spawn-based west cascade for explicit syncs.
  - **Regen-first board modules**: `.cuttlefish/board.ts` + `board.json` are
    derived artifacts. Every build regenerates them when ANY input moves —
    the config's `board:` field, the catalog record, the tree provenance, or
    the extraction revision — via a source fingerprint stamped into
    board.json. A changed board in Zephyr or the config recreates the
    project's board artifacts on the next `cuttlefish build`, no command
    needed.
  - **Catalogs self-heal**: builds create the machine-local overlay when
    missing and re-walk the tree when its VERSION/git HEAD/boards-mtime or
    the generator revision moves past the overlay's recorded provenance
    (fs-only checks; the 6s walk happens once per tree change, not per
    build). `cuttlefish board sync` remains the explicit, verbose form and
    now diffs against the PREVIOUS overlay (what changed in your tree).
  - **Tests** resolve against a checked-in fixture overlay
    (`tests/fixtures/board-catalog.overlay.json`, ~75 boards generated from
    the pinned tree filtered to the ids the suites reference) instead of the
    pack — hermetic, and a few hundred lines instead of 102k.
  
  
  ## The installed SDK is the source of truth — `cuttlefish create` gates on it
  
  The zephyr-installer bin is tightly integrated into the workspace, and a
  project without a working SDK is useless — so create refuses to scaffold
  one without it:
  
  - **`cuttlefish create` checks the SDK first** (native-desktop targets
    excepted): a missing install fails with the exact installer command, and
    a tree that doesn't match the workspace pin (`v4.4.2`, SDK `1.0.1`)
    fails with re-pin guidance. The pin mirrors the installer's
    `versions.env`, and a drift-guard test keeps the two in lockstep.
  - **SDK fingerprint** (`sdkFingerprint`: sha of the tree's VERSION + git
    HEAD) identifies the install everywhere — printed by `cuttlefish
    doctor` and `cuttlefish board sync` next to the pin.
  - **The board registry builds from the installed SDK at create time**:
    create runs the catalog refresh before listing boards, so a fresh
    machine gets its registry (1,313 variants on the pinned tree) generated
    on demand — nothing ships pre-baked.
  - **`$ZEPHYR_BASE` is authoritative** when set: an explicit pointer that
    isn't a tree is reported, not papered over with a well-known-workspace
    fallback (and it makes SDK-state tests deterministic on machines that
    have `~/zephyrproject`).
  - `CUTTLEFISH_SDK_CHECK=off` bypasses the gate for experts tracking their
    own tree; the build-time compat range (`>=4.3 <5.0`) still applies.
- fbd0820: Board and MCU packages are gone — replaced by SDK-derived, project-local board modules.
  
  The 18 hand-maintained packages (`@typecad/board-*`, `@typecad/mcu-*`) duplicated data the Zephyr tree already carries. They are deleted outright; no shims, no deprecation path. What replaces them:
  
  - **A generated board data pack** (`framework-zephyr/src/sdk/board-data.generated.ts`): 1311 board variants extracted from the pinned Zephyr 4.4 tree by a tolerant DTS reader — LED/BUTTON devicetree specs, console UART, connector gpio-maps — regenerated explicitly via `node scripts/gen-zephyr-board-data.mjs`.
  - **Consolidated soc descriptors** (`framework-zephyr/src/chips/soc/`): the nine validated SoCs' silicon facts (GPIO controller splits, ADC channel maps, PWM matrices, probe methods, custom-board inputs) in one registry keyed by SoC name, mechanically migrated from the package data by `scripts/gen-soc-descriptors.mjs` plus curated tier/naming/exclusion facts.
  - **boardgen** (`framework-zephyr/src/boardgen.ts`): joins a pack entry with its soc descriptor and emits `.cuttlefish/board.ts` (typed `Pin.fromPort` datasheet names, LED/BUTTON, connector labels, bus selectors) + `.cuttlefish/board.json` (the BoardConstants flat map, pin manifest, tier). Projects get both on first build; they are project-pinned and diffable.
  
  **Config shape:** `board:` is now a qualified Zephyr target (`'esp32s3_devkitc/esp32s3/procpu'`); `mcu:` is gone. Contract projects (custom PCBs) use `soc: 'stm32f411xe'` + `contract:` — the narrowed board and the soc's board.json generate from the registry. The scaffold wizard, `cuttlefish create` targets, and starter programs ride the same catalog (any of the 1311 targets; starters are thin-HAL).
  
  **Resolution:** `import { GPIO2 } from '@typecad/board'` resolves to the project-local generated module (a walk-up from the source file); chip resolution keys off the manifest's `zephyr.soc` into the soc registry. Hardware-verified end to end on the ESP32-S3 rig (WiFi/store/File+MQTT suites) with no board package anywhere in the tree.
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
- fbd0820: ESP32-S3 Zephyr: native USB CDC and LEDC PWM were data gaps, not missing machinery — both now work on `esp32s3_devkitc` targets (verified by a full `west build` against Zephyr 4.4.2 / SDK 1.0.1: devicetree, kernel, and app compile and link).
  
  - **USB CDC serial (`USB0`)**: the chip descriptor + board package now declare `usb` (`zephyr_udc0`, one CDC-ACM instance, PID 0x0006), and the MCU package exports the `USB0` peripheral instance (same shape as the STM32F411 package). The board DTS already shipped `zephyr_udc0: &usb_otg { status = "okay"; }` and the DWC2 UDC driver is DT-default-on, so declaring the field is the whole fix — `usb.*` ops stop failing the "board does not expose USB" gate, and `console.output: 'usb'` now routes `console.log` through the S3's USB-C connector (console stays on uart0/the on-board bridge otherwise).
  - **PWM + tone (LEDC)**: new `pwm.matrix` descriptor shape for any-pin/any-channel controllers. ESP32 LEDC can't be a static spec list (two arbitrary pins would collide on a statically assigned channel), so channels are assigned at build time to the pins the program actually drives: the overlay generator emits the `LEDC_CH<ch>_GPIO<pin>` pinctrl pinmux group, the `channelN@N` child nodes (`reg` + `timer`, round-robined over the 4 LEDC timers), and the pwm-leds consumer + `tc-pwm<pin>` alias the lowering addresses. `pwm.write`/`tone` on any of 29 PWM-safe pads (excludes the boot strap, USB D±, flash/PSRAM, octal-PSRAM, and console pads); driving more than 8 pins is a clear build error; the false "lowers to a no-op" diagnostic is gone. `tone` additionally resolves its own pin instead of the board's first PWM spec, and `zephyr.pwm.matrix.{controller,channelCount,pins}` board-package keys resolve through the same path as the hardcoded chip registry.
  - **Overlay**: pwm-leds emission now carries `#include <zephyr/dt-bindings/pwm/pwm.h>` — the `PWM_POLARITY_NORMAL` cell macro is only in the DTS include chain on boards that already use PWM bindings (STM32 yes, ESP32-S3 no), and without the include dtc rejects the cell ("expected number or parenthesized expression").
- fbd0820: Legacy-HAL removal — Family 3: the Arduino-named timing surface and legacy singleton APIs are gone. The kept-surface rule held throughout: every deletion happened only after its replacement existed and demos/tests migrated.
  
  - **Demo sweep first** (the deletion gate): wifi-demo's 11 programs and demo-shadcn swept off `delay()` → `Time.sleep`; two files converted from `D2.asOutput()` to `new GPIO(D2, GPIO.OUTPUT)`. Both demos transpile clean.
  - **`hal/timing.ts` deleted**: `TimingClass`, `delay/millis/micros/delayMicroseconds/freeHeap`. The JS-named timers (`setInterval/setTimeout/clearInterval/clearTimeout`) moved to `hal/time.ts` unchanged — they were the one Arduino-era piece that predates Arduino and lowers cleanly everywhere (`__tc_setInterval` k_timer polyfill). Legacy ops `timing.delay/delay_microseconds/millis/micros/free_heap` pruned from KINDS/interfaces/resolver/usage/analysis/async-machine/lowering/manifest; `timing.sleep` remains the sole awaitable deadline op.
  - **WDT**: legacy `enable/reset` (WDTO/string parsing) removed; `Watchdog` keeps construction-time `wdt.setup/feed/disable`.
  - **HardwareTimer**: instance methods (`setFrequency/onOverflow/start/stop`) removed — `Counter` owns those verbs; the counter init-state emission (shared device handle/hz/callback vars) is retained for Counter.
  - **Validator/test fixtures updated**: probe payload tables and timing fixtures no longer reference removed ops; empty `hwtimer` manifest section dropped.
  - Suites rewritten to surviving surface: timing (Time.* + interval polyfill), wdt (setup/feed/disable + init state), hwtimer (init block + Counter ownership).
  
  Full battery: 314 files / 3198 tests passing.
  
  Remaining in Phase 2 ledger: ADC/DAC singleton classes (`ADC.read(pin)`/`setAnalogReference`, `DAC.write`) — kept until board-package exports are audited; pin-state-tracking deletion (16 sites; triggers still partially live via thin gpio.set).
- a9bcb6e: ## Flash runner configuration: `zephyr.runnerArgs` + SDK openocd on PATH
  
  The upload method is now fully config-driven:
  
  - **`zephyr.runnerArgs`** (new) passes extra flags verbatim to `west flash`
    after the runner — anything the chosen runner's parser accepts. The
    common case is documented on the website: flashing a Black Pill over an
    ST-Link with `runner: 'openocd'` and
    `runnerArgs: ['--cmd-pre-init=reset_config none']` (most ST-Link setups
    leave the SRST line unwired; without the override openocd's `reset init`
    times out waiting for the target to halt). Threaded through the Zod
    schema, the config loader (which previously dropped unknown `zephyr`
    keys), and `buildFlashArgs`.
  - **SDK openocd is on the flash PATH.** The west discovery reads the
    installer-written `TYPECAD_ZEPHYR_SDK_INSTALL_DIR` and prepends the SDK's
    `hosttools/openocd/bin` to the spawned west's PATH (honoring
    `$ZEPHYR_SDK_INSTALL_DIR` when an env is activated), so `openocd` SWD
    flashing works with no global install.
  
  Verified on hardware: compile → openocd → ST-Link → flash → reset-to-run
  against a Black Pill V2.0.
- ## Generic/native debug codegen that compiles, plus openocd reset policy
  
  - **The printf rewrite.** The generic/native `--debug` codegen used to inject
    raw `std::cout << ...` text as "TypeScript"; the parser read `std::cout` as
    a label and the emitted C++ was `std: :` noise that could never compile.
    Every injected line now rides the `rawCpp()` passthrough (the call lowers to
    `__EMIT__` and its string argument is emitted verbatim), so the generator
    can author arbitrary C++ — printf with `static_cast`s, a getchar-based
    halt, and the static skip flag — without the TS parser ever seeing it.
    `printf`/`getchar` pull in `<cstdio>` on demand (program-analysis marks
    `usesCstdio` from `__EMIT__` string arguments). Press `s` + Enter at a
    breakpoint halt to skip it from then on; any other key (or EOF) re-arms it.
  - **The debug dialect follows the emitting strategy.** The preprocessor used
    to pick its codegen from the global loaded-framework registry, which could
    emit Zephyr `printk` lines into a native build. The strategy that will EMIT
    the file now decides the dialect; strategies without their own debug
    codegen (NativeStrategy) fall back to the generic printf generator.
  - **openocd session reset policy: `reset_config none`.** The session's resets
    are core-domain by design (vector-catch halt before the flash write,
    SYSRESETREQ to boot), so they must not depend on the SRST pin. Boards like
    the WeAct Black Pill don't break NRST out at all: under the board cfg's
    `srst_only`, every `reset` asserts a pin that reaches nothing while the
    probe's floating SRST sense reports phantom "external reset detected"
    events. Method-declared west quirks (`--cmd-pre-init=…`) are appended after
    and override the default, in the same position west gives them (after the
    cfg, before `init`).
  - **`--port` is required only where it is consumed.** `uploadRequiresPort`
    gates on the resolved runner — esptool and bossac are the only runners that
    cannot flash without a serial port, so probe runners (openocd, jlink) and
    USB flows (dfu-util, uf2) are no longer blocked by a missing `--port`.
- fbd0820: Generic sensor peripherals: `new Sensor(SENSOR.sensirion_sht3xd, I2C1.device(0x44))` covers every Zephyr sensor driver with no per-part code, no devicetree text, and no Kconfig edits.
  
  - **Generated catalog** (`packages/hal/src/sensor-catalog.generated.ts`, `scripts/gen-zephyr-sensor-parts.mjs`): 215 parts derived from Zephyr's `dts/bindings/sensor/*.yaml` (compatible, bus, description) joined against the in-tree drivers' `SENSOR_CHAN_*` occurrences. `SENSOR.<underscored-compatible>` is the completion surface; `CHAN.<name>` mirrors `enum sensor_channel` minus the prefix.
  - **Channel narrowing (editor-time)**: the generated SensorChannelOf type map (215 literal unions, same generator pass as the data record) keys Sensor<P>.get() to the constructed part — new Sensor(SENSOR.sensirion_sht3xd, …).get( completes exactly AMBIENT_TEMP | HUMIDITY and rejects other parts' channels at the type-check. Channel tokens are branded (Channel<N>), so argument-position completion inserts the fully-qualified CHAN.<name> (typing AMBIENT completes CHAN.AMBIENT_TEMP) and plain string literals no longer match narrowed parts. SPI parts work the same way (new Sensor(SENSOR.bosch_bme280, SPI0.device(PA4))): the overlay emits cs-gpios plus a child node whose reg is the CS index (1 MHz conservative default), the bus kind travels on the ops, and instance-level bus claims keep the resource-conflict checker scoped to used controllers. Constructor options ({ spiHz, mode, alert }) reach the devicetree via a config comment on the state block; the bus argument is typed per part (SensorBusOf) so wrong-bus construction is an editor error; a display panel and SPI sensors on one controller get a merged cs-gpios; and the catalog carries a kconfig exceptions path, applied per constructed part by the prj.conf resolver (empty for every in-tree part today). The transpiler re-validates at build time with the driver's full channel list.
  - **Sensor HAL class**: `fetch()` → `sensor_sample_fetch`, `get(CHAN.X)` → `sensor_channel_get` with the `sensor_value` double conversion. Channels the driver doesn't serve are build errors naming the driver's own channel list.
  - **Zephyr lowering**: one device-handle state block per constructed sensor (`DEVICE_DT_GET(DT_NODELABEL(tc_<part>_i2c<N>_0x<addr>))`); the overlay generator emits the DT child node, which is the driver's enable switch (Kconfig `default y` on `DT_HAS_<COMPAT>_ENABLED`). Only `CONFIG_SENSOR=y` is set, usage-gated off the lowered tokens. The bus controller is enabled for sensor-only programs that never call `i2c.*` directly.
- fbd0820: `npm run hal` — hardware HAL tests for framework-zephyr, auto-discovering the connected board. First wet run of the thin HAL; it caught and fixed four real lowering bugs before passing 4/4 on a Black Pill F411CE.
  
  - **The runner** (`packages/framework-zephyr/hal/`): a per-board project structure (`hal/blackpill/`, `hal/nano33iot/`, `hal/esp32s3/`) plus `hal/run.mjs`, which lists the USB serial ports once, matches each project's CDC identity, runs `cuttlefish-test` in every CONNECTED project's dir, and skips absent boards with one line — `npm run hal` exercises the whole rig. Each project's `cuttlefish.config.ts` finds its board by USB identity from the board package's `usb` block (blackpill `2FE3:0002` via the stlink SWD probe; nano `2FE3:0003` via the BOSSA bootloader with the automatic 1200-baud touch-reset — no double-tap, no probe wiring; esp32-s3 via the devkit's CH34x USB-UART bridge `1A86:55D3`, which carries both the esptool flash and the uart0 console and never re-enumerates), with `console.output: 'usb'` carrying the protocol on the CDC boards (and, on the nano, freeing sercom5 for the UART test). Pipeline per board: expect-preprocess → transpile → west build → flash → re-enumeration wait → serial capture → host-side assertions. Verified passing on hardware — blackpill 4/4 (`Time.now → 950`, `button (ACTIVE_LOW, unpressed) → logically 0`, `ADC(PA1) → 933`, `I2C reg on empty bus → 0`); nano 5/5 (`Time.now → 2419`, `pull-up input A2/PA11 → 1`, `ADC(A0) → 4095` — the documented VDD/2-reference saturation on a floating pin, `I2C on empty bus → 0`, `UART idle poll read → -1` — Zephyr's own poll semantics); esp32-s3 4/4 (`Time.now`, `BOOT button (sw0, active-low) → logically 0`, `ADC(A0, gain-1x internal ref) within 12 bits`, `I2C on empty bus → 0`) — including the LEDC matrix PWM, the ADC1 construction tokens, and wdt0 on the S3. The nano suite is the SAMD21-honest subset: no watchdog (the samd21 dtsi exposes no watchdog node) and LED-over-PWM pin sharing documented.
  - **ESP32-through-bridge console fix**: a serial port's default DTR/RTS state on open holds EN (reset) asserted via the devkit's auto-download circuit — the board never boots while the host port is open, so the first S3 run timed out in total silence. The esp32s3 project sets `test.resetAfterOpen: true`, whose existing pulse-and-RELEASE sequence boots the app under the capture.
  - **Board-package `npm run hal` rewired to the thin rig**: the board packages' `hal` scripts previously pointed at the LEGACY hardware suite (`@typecad/hal`'s `test:hw` with `packages/hal/boards/*.config.ts` — the frozen Pin.asOutput-era classes). `board-esp32s3`, `board-blackpill-f411ce`, and `board-nano-33-iot` now run `framework-zephyr/hal/run.mjs --board <dir>` (the runner gained a `--board` filter), with `framework-zephyr`'s own `npm run hal` still running the whole connected rig. Other board packages keep the legacy path until they gain thin-rig projects.
  - **Pin-conflict checker fix** (cuttlefish): `isPeripheralActive` claimed every bus instance's pins whenever the bus TYPE appeared (the `usage.i2c ||` disjunct) — on boards whose alternate-bus pin sets overlap another bus's (the blackpill's i2c-alt on PB3/PB4 shares spi2 pins) that manufactured phantom peripheral-peripheral conflicts. When instance data exists, only those instances now claim pins; the bare-type fallback remains for ops that carry no instance.
  - **Lowering fixes the hardware build caught** (framework-zephyr):
    - `SPI_DT_SPEC_GET` in Zephyr 4.4 takes the base operation explicitly — the thin-target state block now passes `SPI_OP_MODE_MASTER | SPI_WORD_SET(8)` (mode bits still come from the node's spi-cpol/spi-cpha).
    - `pwm_set_period_dt` does not exist in 4.4 — the thin-PWM period guard and setPeriod now use `pwm_set_dt(period, 0)`; setPeriod's documented behavior is "resets the pulse to idle" (there is no period-only API).
    - A compatible-less DT node generates NO property macros, so the target node's `spi-max-frequency` vanished from `devicetree_generated.h` — the scaffold now writes an app-local binding (`dts/bindings/cuttlefish,spi-target.yaml`, includes `spi-device.yaml`, no driver) and the overlay stamps that compatible on target nodes.
    - spi_buf buffer casts are const-safe (`const_cast<void*>(static_cast<const void*>(...))`), and single-byte literal arrays (which the resolver collapses to numeric buffer text) take the literal path instead of being mistaken for caller-buffer identifiers — same guard added to i2c dev_write.
- fbd0820: The HAL's next three: generated token truth, thin-op pin validation, docs — plus one new verb and two real bug fixes the work surfaced.
  
  - **Token generator** (`scripts/gen-zephyr-hal-tokens.mjs` → `hal/src/zephyr-tokens.generated.ts`): the GPIO flag, INT, ADC gain, and ADC reference name sets are now parsed from the pinned Zephyr tree's own headers (`enum adc_gain`/`enum adc_reference`, the config/bias defines in `drivers/gpio.h` + `dt-bindings/gpio/gpio.h`). The lowerings build their token→macro maps from the generated lists (three hand maps deleted), and a new sync test (`tests/packages/hal/token-sync.test.ts`) asserts the hand-declared class statics equal the generated sets — a Zephyr revision that adds or renames a token fails CI until the classes update. **This fixed real bugs**: the hand-curated reference set named tokens that don't exist upstream (`REF_VDD_2`, `REF_EXTERNAL`) and missed six gains (`2_7`, `2_5`, `1_2`, `4_5`, `6`, `12`) — the true set is 21 gains / 7 references, verbatim from Zephyr 4.4.2.
  - **Thin-op pin validation**: `profileDiagnostics`' ADC/DAC/PWM pin-validity checks now cover the thin ops (`adc.read_raw`/`read_mv`, `dac.write_value`, `pwm.set_pulse`/`set_duty`/`set_period`) alongside the legacy forms — a non-analog or non-PWM pin is a diagnostic naming the valid pins on the board, instead of a silent comment.
  - **`SPITarget.readReg(reg)`** — the deferred one-byte register-read sugar: `spi_transceive_dt` against an internal buffer, e.g. a BME280's ID register (`flash.readReg(0xD0)` → 0x60). New op `spi.reg_read`, supported on Zephyr / unsupported on frozen Arduino, with the shim state collector and usage accounting wired (the collector gap was found by the hardware probe). This also sidesteps a discovered transpiler limitation: a user-declared `new Uint8Array(n)` that is read after promotion to file scope emits a pointer extern conflicting with its array definition — `readReg` needs no user buffer; the `transceive(tx, rx)` + indexed-read pattern remains affected (recorded as follow-up emitter work).
  - **Docs**: `docs/hal/thin-hal.md` — the whole thin surface in the sensors.md voice: the construction-facts/token/units contract, every class with examples and lowered calls, the honest-absent list (LEDStrip timing table, UART available/peek, Temperature fold), and what the build does with construction facts.
  - **Editor-time narrowing note**: the full type-level story (branded pins from MCU manifest capabilities, GPIO direction generics) remains future work — flag-literal direction narrowing is not expressible with plain numeric tokens (`|` widens), and pin branding is an architectural pass through the MCU/board packages. The build-time validation above is the shipped half.
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
- fbd0820: HTTP client joins the thin HAL: the Http/HttpClass singleton factories and
  the HttpRequest fluent builder are replaced by a fact-carrying Request.
  
  The new `new Request(method, url, opts)` carries the whole request policy at
  construction — method tokens (Request.GET/POST/PUT/DELETE/HEAD/PATCH; plain
  strings also accepted), URL, and the opts { timeoutMs, body, json,
  insecure, caCert }. `header(name, value)` chains for multi-header requests
  (one op per header). `send()` lowers the facts into the shim (timeout/body/
  TLS mode) and performs the request; the response reads from the same
  instance (status/ok/text/contentLength/responseHeader — unchanged).
  Awaited send inside async functions still splits into the background
  request + done-poll. Removed: the Http singleton + its six verb factories
  and the factory-verb/factory-chaining machinery in the parser and
  transformer, the http.reset op (fresh shim state now rides http.begin —
  one reset per request instead of one per factory), the builder setters as
  user API (timeout/maxBody/body/jsonBody/insecure/caCert chained calls), and
  the HttpMethod numeric enum (the class tokens are the strings). The
  set_insecure op carries its flag; absent body/caCert ops elide in the
  lowering.
  
  The transformer captures Request construction facts (shared helper also
  serving bare `new Request(...).send()` receivers via resolveHALReceiver),
  including identifier opts resolving to top-level string consts — the
  PEM-as-const pattern the hardware suite uses (caCert: CA_CERT_PEM decodes
  to the DER byte array at emit time).
  
  Hardware-verified on the ESP32-S3 against the LAN test server: all six
  verbs, status-code parsing (404/201/500), the seven-step CRUD mutation,
  custom headers, and HTTPS with insecure all pass through the new surface
  (19/24 asserts + the four pinned-CA tests still blocked by the documented
  tf-psa-crypto symbol-matrix limitation). All four wifi-demo HTTP programs
  and both http test suites are migrated.
- fbd0820: Legacy HAL removal — Phase 0 + the first legacy slice (the repo stays green; the remaining phases are sequenced behind this).
  
  **Phase 0 — gap closers (the thin replacements for legacy features the removal needs):**
  - `PWM.tone(hz)` — the legacy `tone()` as sugar: one `pwm_set_dt` at 50% duty (`period = 1e9/hz`). Documented channel-ownership caveat: tone takes over the period; a later setPulse/setDuty at a not-yet-run call site re-applies the construction period once.
  - `shiftOut(dataPin, clockPin, value, msbFirst?)` / `shiftIn(dataPin, clockPin, msbFirst?)` — the legacy shift shape as free functions lowering to ONE op each (`gpio.shift_out`/`gpio.shift_in`): both pins configured once (guarded), then a Zephyr-verbs bit-bang loop (`gpio_pin_set_raw` / `gpio_pin_get_raw` + `k_busy_wait`). New ops wired through the IR, resolver, usage accounting, manifests, and lowering; documented "for real SPI use SPITarget".
  
  **Legacy shift — fully removed** (pulled forward from Phase 2 after the collision it caused): `hal/shift.ts` (the `Shift` class + free functions + `shiftOut_`/`shiftIn_` stubs), the `shift.out`/`shift.in` ops and resolver cases, the manifest sections in BOTH frameworks, the validator's `shift` category + prefix, the strategy ambient flags, the pulse-or-shift lowering's shift half, and the legacy tests. The removal surfaced a real registry hazard worth recording: `halGlobalFunctions` is keyed by bare function name with LAST-FILE-WINS semantics — the legacy `shift.ts` (alphabetically after `shift-pin.ts`) silently overwrote the thin entry, which is why the thin functions "didn't work" until the legacy file was deleted.
  
  **Deferred with reasons**: `pulseIn`/`Pulse` (counter-based input capture needs a hardware-validated design — 2–3 days), `waitForRising/Falling` (interrupt-based thin equivalent, 1 day). Both are on the removal's Phase-0 ledger before the legacy files go.
  
  **Remaining phases** (tracked in the removal plan): 1a port the Arduino demos (UI trio configs + network demo conversions), 1b delete framework-arduino/arduino-cli/mcu-atmega328p/board-arduino-uno + the legacy hal hardware suite, 2 gut the remaining legacy classes/ops (GPIO/PWM/ADC/Wire/tone/timing/… + `pin-state-tracking.ts` wholesale) with the ~300–500 test updates, 3 simulator contracts, 4 docs/semver.
- fbd0820: Legacy-HAL removal — **Phase 1b: framework-arduino and the AVR path are deleted.** This retires the "frozen Arduino" surface; the repository is Zephyr (+ native desktop simulator) only.
  
  **Deleted packages**:
  - `@typecad/framework-arduino` — the ArduinoStrategy, Adafruit display/touch adapters, arduino-cli compile/upload integration, AVR profiles, doctor. Its published npm artifacts remain installable for old projects.
  - `mcu-atmega328p`, `board-arduino-uno` — AVR silicon has no Zephyr port; the Uno/pro-mini hardware story ends here.
  
  **Deleted demos** (frozen-Arduino targets): ble-demo, demo-display, demo-pro-mini, demo-safety, demo-st, demo-ui, demo-ui-sd13, demo-weather, rmt-demo. Their thin-Zephyr counterparts exist (zephyr-display/zephyr-ui/zephyr-weather/zephyr-blink family) or are covered by the hal rig.
  
  **Deleted test surface**: ~150 test files whose assertions were specifically about the removed Arduino lowerings (transpileArduino/AVR/ESP32 helpers, uno wiring, Arduino manifest/avr-profile suites) — they tested deleted behavior and die with it. Remaining verified battery: 3228 passing across 314 files after cleanup, including the full framework-zephyr directory, compliance, manifests, expect dry-runs, and token sync.
  
  **Test harness**: `tests/setup.ts` + `tests/setup-framework.ts` now register `ZephyrStrategy` as the default loaded framework; the deleted transpileArduino/transpileAVR/transpileESP32 helpers are gone. The boardConstants injection for board-derived chip resolution was re-applied (it briefly vanished with the setup restore).
  
  **Deferred deliberately**: `@typecad/arduino-cli` package remains — @typecad/expect's host compiler imports its env-check helper; unwrapping that dependency is a small follow-up before it too can go. Root README/docs mentions of Arduino are Phase-4 documentation work.
- e15fb1c: ## MCU-only targets: program bare silicon without a board package
  
  An `mcu:`-only config (no `board:`) now works end to end. Previously the
  transpiler silently accepted it but emitted untranslated pin calls (broken
  C++): the board-constants resolver only recognized `@typecad/board-*`
  packages. `tryResolveBoardDefFile()` now resolves `@typecad/mcu-*` packages
  (`src/mcu.ts` or inline `src/index.ts`) and loads the sibling
  `peripherals.ts`, so pin lowering, capability validation, and peripheral
  validation work from the silicon definition alone. `board` is un-deprecated:
  boards layer assets on top of the MCU; MCU-only trades those assets for
  hardware reach. All MCU packages now re-export `@typecad/hal` (mirroring
  board packages), so `@typecad/board` code resolves identically either way.
  
  ### Zephyr custom-board generation (`zephyr.customBoard: true`)
  
  MCU packages carry a **silicon-level `zephyr` block** (the lower layer of the
  board packages' field — SoC name(s), devicetree includes, GPIO controller
  split, default console mux, default clock plan; `mcu-stm32f411` ships the
  first one, `MCUDefinition.zephyr` is the typed field). With
  `zephyr: { customBoard: true }` in cuttlefish.config.ts, framework-zephyr
  generates an out-of-tree board for the chip under `boards/typecad/<buildTarget>/`
  (board.yml + dts + Kconfig.<name> + defconfig — the four load-bearing files
  verified by building a hand-written minimal board against Zephyr 4.4). The
  app's CMakeLists.txt adds itself to BOARD_ROOT, the usage-driven overlay
  keeps layering on top, and `resolveChipFromBoard()` accepts silicon-resolved
  chips (gated on `zephyr.socs`, no board target required).
  
  End-to-end verified on the hardware toolchain: `cuttlefish create my-f411
  --mcu stm32f411` then `cuttlefish build --compile` transpiles (PA5 → `gpioa`
  pin 5 via the silicon controller split), generates the board, and links a
  zephyr.bin. Contract-based configs (contract + mcu, board forbidden by the
  schema) ride the same machinery: the narrowed `.cuttlefish/board.ts` plus
  `zephyr.customBoard` for the PCB's own board.
  
  ### `cuttlefish create` for bare MCUs
  
  `cuttlefish create --mcu <id>` scaffolds MCU-only projects (also offered in
  the interactive wizard). Zephyr targets default to a generated custom board
  named after the project, or pick any existing Zephyr board from the new
  **exhaustive board snapshot** (1014 boards across 587 SoCs, enumerated from
  the pinned Zephyr 4.4 revision via `scripts/gen-zephyr-boards.mjs` —
  regenerate as part of the version-bump checklist), filtered by the MCU's
  SoC. Arduino targets paste an FQBN found via `arduino-cli board search`
  (`--fqbn arduino:avr:pro` non-interactively) — e.g. an Arduino Pro Mini with
  no board package: `cuttlefish create my-pro-mini --mcu atmega328p --fqbn
  arduino:avr:pro`.
  
  v1 scope: the generated board enables the console UART only — non-console
  buses need per-controller pinctrl synthesis data in the MCU package first
  (STM32 bindings require pinctrl-0 on enabled nodes). Flashing a custom
  board uses `zephyr.runner`/`runnerArgs` (no probe-method table on silicon).
  
  ### Demos
  
  - `demos/demo-pro-mini` — MCU-only Arduino: a Pro Mini programmed through
    `@typecad/mcu-atmega328p` alone (`arduino:avr:pro`), verified through
    arduino-cli compile (204 B / 2 KB RAM) and `--autosar=strict`.
  - `demos/demo-contract-board` — contract + Zephyr custom board: a custom
    STM32F411 PCB described by `board.contract.json` (typecad.net export),
    narrowed to the wired pins, with the generated out-of-tree board linked to
    a `zephyr.bin` through west.
  
  The contract demo exposed a class of gaps: Zephyr bindings require
  board-DTS properties a generated custom board must therefore carry. A full
  audit of every devicetree touch (overlay + generator) against the Zephyr
  4.4 bindings found and fixed three more beyond the ADC node
  (`st,adc-clock-source`/`st,adc-prescaler`):
  
  - **PWM** — the overlay enables `&pwm<N>` and composes pwm-leds consumers
    against it, but the `pwmN` label exists only when a board DTS declares it
    (the SoC dtsi ships the timers' pwm child unlabeled), and st,stm32-pwm
    requires pinctrl-0. PWM specs gained `pinctrl` tokens
    (tim4_ch1_pb6/tim4_ch2_pb7) and the generator emits the blackpill-shape
    `&timers4 { pwm4: pwm { pinctrl-0 = <...>; status = "okay"; } }` for
    controllers with full token coverage.
  - **USB** — st,stm32-otgfs requires pinctrl-0 on an enabled node. The
    silicon usb block gained pinctrl tokens (usb_otg_fs_dm_pa11/dp_pa12) and
    the generated board pre-enables zephyr_udc0 with them. The MCU package
    also exports the `USB0` CDC instance (silicon peripheral, previously a
    board-package-only export — USB was unusable on MCU-only projects).
  - **Preferences/FS** — the overlay's `/chosen zephyr,settings-partition`
    references a `storage_partition` label nothing defined on a custom board.
    The silicon block carries the default storage region (256 KB at 0x40000,
    the blackpill-proven layout); the overlay synthesizes it as before.
  
  Verified by compiling a worst-case program (PWM via pwm() + tone(), WDT,
  Preferences, USB CDC, GPIO, console) to a zephyr.bin on a generated board.
  Audit also confirmed safe: watchdog (reg only), the console UART (pinned in
  the board DTS), and DAC (F411 has none).
- a9bcb6e: ## Named probe methods: pick `stlink`/`dfu`/`jlink` for flashing AND debugging
  
  Users think "I have an ST-Link", not "openocd with `--cmd-pre-init=reset_config
  none`". Attachment — flashing and debugging alike — is now selected by a
  board-defined name:
  
  - **Board packages ship a `probeMethods` table** mapping friendly ids
    (`stlink`, `dfu`, `jlink`, `uf2`, `openocd`) to the west runner plus the
    args the method always needs. Hardware quirks live with the board data
    where they're verified, not in user configs. One method serves both
    surfaces; entries that cannot debug (bootloaders) set `debug: false`.
    The Black Pill ships stlink/dfu/jlink; the XIAO ships jlink/openocd/uf2.
  - **`zephyr.probe`** in cuttlefish.config.ts selects one; **`--probe <id>`**
    on the CLI overrides it for a single run. Unknown ids fail with the
    board's supported list; `probe` + `runner` together is rejected. User
    `runnerArgs` still append after a method's flags, so they can override.
  - **Debugging resolves through the same method.** The toolchain's `debug()`
    runs `west debug` with the method's runner + quirks, and rejects
    debug-incapable methods with the debug-capable list ("a bootloader is not
    a debugger"). The VS Code launch.json/openocd.cfg generation feeds from
    the table too: method-carried cfg sources + quirk lines, cortex-debug
    `servertype: jlink` (with the board's device name) vs `openocd`, and the
    wire interface (swd vs the ESP32's jtag).
  - **`cuttlefish create` asks** which probe you'll attach when the board has
    options, and writes the config section; `--probe` on create answers it
    non-interactively.
  - **`cuttlefish doctor` lists** the board's methods, with the debug-capable
    subset on its own line.
  
  No auto-detection: the method is always something you chose.
- fbd0820: Phase 2 closing: legacy op surface and ADC/DAC singletons removed. The HAL's user-facing vocabulary is now thin-only.
  
  - **ADC/DAC singleton classes deleted** (`hal/adc.ts` `ADCClass`/`ADC`, `hal/dac.ts` `DACClass`/`DAC`) — audited: no consumers outside the index barrel (the simulator binds its own analog-pin classes). Their legacy ops pruned end-to-end: `adc.read/read_voltage/get_resolution/set_reference/get_reference/dac.write` gone from KINDS, interfaces, resolver, usage analysis, Zephyr lowerings, and the framework-zephyr manifest. The thin surface (`ADCChannel` construction-gain ops, `DACChannel.write_value`) is the only ADC/DAC path.
  - **Resulting legacy-op surface**: 43 (wire-dance/manual-CS/uart-print family) + 13 (timing/WDT/HardwareTimer + gpio.set_mode/interrupt.attach) + 6 (adc/dac) = **62 op kinds removed this phase**, on top of Family 1's class deletions. KINDS list, manifest matrices, usage analysis, and both frameworks' lowerings all pruned to match; validator fixtures updated.
  - **Suites rewritten to surviving surface**: adc/dac hal-resolution tests now cover only thin verbs (read_mv descriptor-defaults regression kept; write_value lazy-setup per pin). Two empty legacy describes dropped.
  - Full battery: 314 files / 3189+ tests green (isolated rerun for the two known worker-race files — see below).
  
  **Deferred with reasons**: pin-state-tracking deletion — audit showed its folding triggers are NOT fully dead: thin `GPIO.set()` still fires notePinWrite, so removal requires rewiring route-hal-op's shadow-var read path AND control-flow snapshot logic in one careful pass (~1 day), not a mechanical cut. Recorded as the first Phase-2b item.
  
  Known infra issue (pre-existing, now documented twice): full parallel vitest runs intermittently produce an empty transpile output file for 1–2 e2e files (cold `.build/tests` write race); every affected file passes standalone and on warm runs. Fix is per-file build dirs or sequential e2e config.
- 92c1bc6: ## Raspberry Pi Pico / Pico 2 — Zephyr parity and fixes
  
  Close the gaps the USB CDC commit (a9bcb6ea) left on the RP2040/RP2350
  boards, plus one capability breakage that affected both frameworks:
  
  - **fix(mcus): `analogRead` works again.** The board-constants flattener is a
    static AST walker; `functions: [adc(0, 0)]` (helper-call array elements)
    and shorthand `capabilities` references flatten to nothing, so the
    pin-capability validator rejected every analog pin on both boards with
    "no pins support analog input". The MCU packages now carry inline object
    literals (the pattern every working MCU package already used). mcu-rp2350
    also marks GP23/GP24/GP25/GP29 unsafe (SMPS power-save, VBUS detect, LED,
    VSYS monitor on the Pico 2), mirroring mcu-rp2040.
  - **feat(boards): USB CDC serial (`USB0`).** Both Pico boards declare
    `zephyr.usb` (`zephyr_udc0`, enabled by default in the rpi_pico /
    rpi_pico2 DTS, backed by the `udc_rpi_pico.c` next-stack driver) and
    export `USB0` — USB CDC is the Pico's primary serial link. Verified with
    a full west build: the overlay composes the CDC class instance and the
    prj.conf emits the `USB_DEVICE_STACK_NEXT` symbols.
  - **feat(boards): named probe methods** (`uf2` BOOTSEL bootloader, `openocd`
    CMSIS-DAP SWD, `jlink`) so `zephyr.probe` / `--probe` work without the raw
    runner escape hatch; `consoleDescription` (uart0 on GP0/GP1) for the
    console-destination build note; `i2c1` declared (GP6/GP7 — the board DTS
    ships its pinctrl group, so `Wire1`/`I2C1` now works instead of erroring).
  - **fix(board-rp2350): honest pin collections.** The pins arrays dropped
    GP23–GP25/GP29 (board-internal) and GP30–GP33 (they don't exist on the
    Pico 2's RP2350A — `rp2350a.dtsi` sets gpio0 `ngpios = <30>`), matching
    the actual header (GP0–GP22 + GP26–GP28).
  - **feat(cuttlefish): `cuttlefish create` offers Zephyr for the Pico boards**
    (architecture map, qualified west targets `rpi_pico` /
    `rpi_pico2/rp2350a/m33`, and the wizard's probe-method table).
  - **fix(cuttlefish): peripheral capacity derives from declared instances.**
    `peripherals.<bus>.count` defaulted to 1 when the board carried no
    explicit count, rejecting the second I2C/SPI/UART the MCU actually
    declares (Wire1/SPI1/Serial2 on the arduino-pico and ESP32 cores); the
    count now falls back to the flattened instance entries.
  - **feat(framework-zephyr): build-time diagnostics for silent no-ops.**
    `pwm`/`tone` on a pin with no chip-descriptor spec now warns (previously a
    silent comment no-op — the Pico boards ship no PWM specs), and an
    i2c/spi/uart instance beyond the declared controllers is a clear error
    (previously an undefined-symbol link failure).
  - **fix(framework-zephyr): I2C/SPI class usage no longer breaks west builds.**
    Three fixes found while e2e-verifying I2C1 on real `west` builds:
    `filterRequiredIncludes` now strips the Arduino library headers the HAL
    registers (`<Wire.h>`/`<SPI.h>`/`<EEPROM.h>` — gcc: "Wire.h: No such file
    or directory"); bus shim state is emitted only for the controller indexes
    the program drives (an unused declared controller's static state trips
    Zephyr's -Werror `-Wunused-variable`); and the overlay usage scan accepts
    the shim's `__tc_<bus>N` state tokens, so a begin()-only program still
    gets its DT node enabled (previously a missing `__device_dts_ord_*`
    device error). The overlay also enables only the used controllers — an
    enabled-but-unused i2c0 would claim GP4/GP5 that a program driving i2c1
    may want as GPIO. Verified with full `west` builds for `rpi_pico` and
    `rpi_pico2/rp2350a/m33`: USB CDC (`USB0.println`), ADC reads, `I2C1`, and
    `console.output: 'usb'` (printk rebound onto the CDC port) all compile
    to `zephyr.bin`.
- e15fb1c: ## SAMD21 support: the Arduino Nano 33 IoT (`arduino_nano_33_iot/samd21g18a`)
  
  The first Microchip SAM target. `@typecad/mcu-samd21` defines the SAMD21G18A
  silicon as wired on the Nano 33 IoT (34 modeled pins in port-block numbering —
  PA<bit> → bit, PB<bit> → 32+bit — sercom4 I2C / sercom1 SPI / sercom5 UART,
  12-bit ADC with 7 header-reachable channels, TCC2 PWM; interrupt capability
  is per-pin because SAM D21 only wires EXTINT to port pins 0–15), and
  `@typecad/board-nano-33-iot` ships the board chip data verified against
  Zephyr 4.3's `arduino_nano_33_iot` devicetree: per-port porta/portb
  controllers, the `led0` (D13/PA17) DT spec, the board-shipped `pwm-led0`
  PWM alias (tcc2/WO1, 46.875 kHz counter clock at the dts prescaler), the
  USB CDC device (per-board PID 0x2FE3:0x0003), and the ADC channel map
  (`ADC_GAIN_1` + `ADC_REF_VDD_1_2` — the only reference combination Zephyr's
  sam0 ADC driver accepts on this SoC; reads saturate above ~1.65 V).
  `cuttlefish create --target nano-33-iot` scaffolds it; flashing works over
  the built-in BOSSA USB bootloader (`bossac`, double-tap reset) or via
  openocd/jlink on the underside SWD pads.
  
  Scope notes:
  
  - **WiFi and BLE are unsupported.** The onboard NINA-W102 radio has no
    descriptor fields, so `wifi.*` / `ble.*` ops fail diagnostics with a clear
    error; its control pins (SPI/UART/reset/irq/ready) are documented as
    repurposable GPIO with warnings.
  - **No watchdog node.** Zephyr's samd21 dtsi exposes no watchdog devicetree
    node, so `wdt.*` ops are flagged and `features.watchdog` is false. This
    surfaced a framework gap, now fixed: `lowerWdt` takes the chip descriptor
    and lowers wdt ops to comments on watchdog-less targets (previously a
    compile error referencing undeclared shim vars), plus a new
    `zephyr-wdt-unavailable` profile diagnostic — mirroring the hwtimer
    pattern.
  - Storage uses the board dts's own `storage_partition` (16 KB at 0x3c000) —
    no synthesized partition needed.
  - **1200-baud touch-to-reset.** Boards whose bootloader cooperates can now
    declare `zephyr.usb.touchReset` (flag address + magic + the bootloader's
    USB identity). The device side: the emitted USB shim registers a usbd
    message callback; when the host sets the CDC baud rate to 1200, the shim
    writes the bootloader's stay-resident magic to RAM (Arduino SAMD scheme:
    0x07738135 at the last word of SRAM) and `NVIC_SystemReset()`s — the board
    lands in the bootloader with no button press. The host side: bossac
    uploads open the app port at 1200 baud, wait for the bootloader identity,
    and flash that port (the touch itself may surface as a port-open error —
    the device resets mid-open — which is handled as success). Verified
    end-to-end on the Nano 33 IoT: `cuttlefish-test` now re-flashes and runs
    the suite with zero manual reset presses.
- a9bcb6e: ## STM32 support: the WeAct Black Pill V2.0 (`blackpill_f411ce/stm32f411xe`)
  
  The first STM32 Zephyr target. `@typecad/mcu-stm32f411` defines the
  F411CEU6 silicon (34 bonded pins in port-block numbering — PA<bit> → bit,
  PB<bit> → 16+bit, PC<bit> → 32+bit — 3× I2C / 3× SPI / 3× USART, ADC1, five
  timers), and `@typecad/board-blackpill-f411ce` ships the board chip data
  verified against Zephyr 4.3's `blackpill_f411ce` devicetree: per-port
  gpioa/gpiob/gpioc controllers, `led0` (PC13) and `sw0` (PA0) DT specs,
  i2c1/spi1/usart1, the `iwdg` watchdog node, TIM4 PWM channels, and the
  ADC1_IN0–IN9 channel map. `cuttlefish create --target blackpill-f411ce`
  scaffolds it; flashing works over ST-Link (`openocd`) or the built-in USB
  DFU bootloader.
  
  framework-zephyr gains the lowering machinery STM32 needs:
  
  - **Synthesized PWM specs.** Boards that enable a PWM controller without a
    DT alias (the STM32 pattern) get one generated: the overlay synthesizes a
    `pwm-leds` consumer + `tc-pwm<pin>` alias, and the lowering addresses the
    channel as `PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm<pin>))`.
  - **SoC-aware ADC channel setup.** The descriptor carries `gain`/`reference`
    (the STM32 driver requires `ADC_GAIN_1` + `ADC_REF_INTERNAL` with
    vref = VDDA; nRF keeps its SAADC scheme), and per-channel `pinctrl` labels
    let the overlay mux exactly the read channels' pads to analog.
- fbd0820: Thin HAL wave 5: FS/Mqtt/Power thinned, four Zephyr-unsupported families cut, and the async tier's silent hal-op drop fixed.
  
  - **`File` replaces `FS`**: `new File(path)` with `read()/write()/exists()/remove()` — construction is the whole configuration; the old `fs.begin()` mount session is gone (littlefs mounts lazily on first use). Verified on hardware (ESP32-S3): write → read → exists → remove round-trip plus a cross-flash marker surviving reflashes.
  - **`Mqtt` thinned**: `new Mqtt('mqtt://host:1883', { clientId })` with `connect()/onMessage()/subscribe()/publish()/linked()/close()`. The client completes its session in a background poll thread (CONNACK wait, keepalive, QoS-1 acks); `connect()` returns void and `linked()` polls. Verified against the test server's Aedes broker on hardware: connect → subscribe → publish → loop-back through `onMessage`.
  - **Fixed: MQTT connect failed with `gai=-2` on numeric-IP brokers.** The shim passed an *uninitialized* `port_str` buffer to `zsock_getaddrinfo`; Zephyr's literal-address parser rejects a service string whose parsed port is outside 1–65535 with `EAI_NONAME` — the same code as a name-resolution failure. The port string is now built with `snprintk` (as the HTTP shim always did). MQTT kconfig also enables `CONFIG_DNS_RESOLVER` so hostname brokers resolve.
  - **`Power` thinned**: `deepSleep(ms)`, `deepSleepUntil(pin, level)`, `lightSleep()`, `setCpuFrequency(mhz)` as verbs on a stateless class (`PowerDefault` exported).
  - **Cut (no Zephyr backing):** `Capacitive`, `Temperature`, `Mdns`, `Ota` classes, their stubs, plugin cases, op kinds, manifest categories, and probe payloads. Also removed the dead `wifiScanStart`/`delayMs`/`getMillis` stub chain.
  - **Fixed: async functions dropped hal-op statements before an `await`.** A chained HAL call (e.g. `new Request('GET', url).header(...).send()`) lowers to a *block* of hal-ops; inside an async function the single-line statement renderer emitted a literal `{` for it — unbalancing the braces and silently discarding every op in the block. Blocks now render their body. Sentinel ops (absent body, `insecure: false`, no CA) elide silently instead of emitting `/* unhandled hal-op */` placeholders and bogus "not registered" warnings, and the no-CA path no longer prints "PEM failed to decode" on every plain-HTTP request.
  - **Async-tier drift repaired:** `AWAITABLE_HAL_OPS` listed op names that no longer exist (`wifi.connect`, `wifi.wait_connected`, `ble.until_connected`) while missing the real `wifi.join`; `await wifi.join()` now gets the proper start/poll split instead of a blocking fallback. `wifi.scan_start` is restored as an internal split op (the shim helper existed; the lowering arm had been cut) so awaited scans start without blocking.
- fbd0820: Tier-1 thin Zephyr-shaped classes — construction facts + Zephyr verbs, one call per method, no semantic translation. Each class follows the Sensor/Time pattern: hollow classes whose construction arguments ride self-contained ops to the lowering; flag/gain tokens are Zephyr's own names carried as source text and mapped name-for-name onto the C macros, with build-time re-validation that names the valid spellings.
  
  - **`GPIO`** (`new GPIO(PB5, GPIO.OUTPUT | GPIO.OUTPUT_INIT_LOW)`): flag tokens replace mode strings — `INPUT_PULLUP` mapping tables are gone on this path; `OUTPUT_INIT_LOW/HIGH` configure the initial level atomically (no configure-then-write glitch window); `set/get/toggle` reuse the polarity-correct dtSpec/raw lowering; the configure itself is guarded per pin and applied ahead of first use. `onInterrupt(GPIO.INT_EDGE_FALLING, …)` uses INT tokens — covering the `INT_LEVEL_*` modes the legacy `onChange` strings could not express.
  - **`PWM`** (`new PWM(PA5, { periodNs: 20_000_000 })`): the period is a construction fact, applied once at first use; `setPulse(ns)` → `pwm_set_pulse_dt` verbatim; `setDuty(0.0–1.0)` is sugar over exactly one `set_pulse` call (no 0–255 scaling anywhere); `setPeriod` exposes `pwm_set_period_dt`, previously hidden. ESP32 LEDC matrix pins resolve through the synthesized `tc-pwm<pin>` alias.
  - **`ADCChannel`** (`new ADCChannel(PA0, { gain: ADCChannel.GAIN_1_4, reference: ADCChannel.REF_INTERNAL })`): gain/reference are construction facts (`struct adc_channel_cfg`'s own fields), defaulting to the chip descriptor's pair; `read()` returns raw counts, `readMillivolts()` applies `adc_raw_to_millivolts`. No `setReference()` — Zephyr applies it at channel-setup time, so the surface doesn't promise runtime switching.
  - **`DACChannel`** (`new DACChannel(PA4, { resolution: 12 })`): raw `dac_write_value` codes (0–4095 at 12-bit), construction resolution overriding the descriptor default, lazy setup per pin.
  - **`Watchdog`** (`new Watchdog(2500)`): timeout-at-construction in ms — `enable()` arms (`wdt_install_timeout` + `wdt_setup`), `feed()` keeps it alive. No WDTO_* presets, no string parsing.
  - **`Counter`** (`new Counter(0, { hz: 1000 })`): Zephyr's counter driver with Zephyr's verbs (`onAlarm`/`start`/`stop`), sharing the hwtimer per-instance state; `start()` carries the construction hz so there is no ordering constraint with `onAlarm`.
  
  New ops: `gpio.configure`, `interrupt.attach_flags`, `pwm.set_pulse`/`set_duty`/`set_period`, `adc.read_raw`/`read_mv`, `dac.write_value`, `wdt.setup`/`wdt.feed`, `counter.on_alarm`/`start`/`stop` — declared supported in framework-zephyr and unsupported in the frozen framework-arduino manifest (legacy classes and their lowerings are untouched and permanent).
- fbd0820: Tier-2 thin buses — Zephyr verbs on every bus, construction facts riding self-contained ops (the Sensor/Time/tier-1 discipline):
  
  - **`I2CTarget`** (`new I2CTarget(I2C0, 0x44, { hz?: 400_000 })`): the Wire transaction dance is replaced by Zephyr's register verbs — `writeReg`/`readReg` → `i2c_reg_write_byte`/`i2c_reg_read_byte`, `updateReg(reg, mask, value)` → the native read-modify-write `i2c_reg_update_byte` (atomic on the wire, no read-back race — `register.ts`-style helpers fold into this), `write(bytes)` → `i2c_write`. The optional `hz` applies once via a guarded `i2c_configure` (Zephyr's `I2C_SPEED_SET` tier mapping).
  - **`SPITarget`** (`new SPITarget(SPI0, PA4, { hz: 10_000_000, mode: 0 })`): construction emits a devicetree child node through the same machinery sensors ride — cs-gpios entry (merged after display/sensor CS with stable reg indexes), `spi-max-frequency`, `spi-cpol`/`spi-cpha` — and the verbs lower to `spi_transceive_dt`/`spi_write_dt` against a static `spi_dt_spec`. **Hardware CS** — the legacy path's manual GPIO toggling and runtime `spi_config` rebuilding are gone. `transceive(tx, rx?)` fills the caller's own buffer (omit `rx` for write-only). The nodelabel discipline is shared (`tc_spit_spi<N>_cs<cs>` derived identically in the lowering, the shim state block, and the new `tc-spit-cfg` overlay-scanner comment — the `tc-sensor-cfg` channel).
  - **`UART`** (`new UART(UART1, { baud: 9600 })`): the poll API, honestly — `write`/`println` → per-byte `uart_poll_out` with the construction baud applied once (guarded `uart_configure`); `read()` → `uart_poll_in`, non-blocking, returning -1 when empty (Zephyr's own semantics). `available()`/`peek()` are deliberately absent: the byte-level poll driver cannot honor them, and the thin surface doesn't promise what the backend can't deliver.
  
  New ops: `i2c.reg_write`/`reg_read`/`reg_update`/`dev_write`, `spi.transceive`/`dev_write`, `uart.poll_write`/`poll_read` — declared supported in framework-zephyr, unsupported in the frozen framework-arduino manifest. Usage analysis accounts the new ops into the controller-instance sets (shim state gating), and `spiTargetsUsed` drives the per-target `spi_dt_spec` blocks.
- fbd0820: Tier-3 thin OS surface — `Thread`, the first raw kernel-thread class:
  
  - **`Thread`** (`new Thread(0, { stackKb: 4, priority: 3 })`): construction carries the thread's facts — `stackKb` (default 2) sizes a static `K_THREAD_STACK_DEFINE`, `priority` (default 5, Zephyr's scale: negative = cooperative) rides the create call. `start(fn)` → `k_thread_create(…, K_NO_WAIT)` through a per-slot entry trampoline bridging Zephyr's `(void*, void*, void*)` signature to the registered no-arg closure (the same callback machinery interrupts use); `join()` → `k_thread_join(…, K_FOREVER)`. State emission is keyed on `thread.start` ops — `join()` without a prior `start()` on the index is a build error naming the slot's symbol, documented on the method. No devicetree, no Kconfig; `kernel.h` (always included) is the whole dependency. The JS `setTimeout`/`setInterval` polyfill (k_timer) is unaffected — different surface, different guarantees.
  - New ops `thread.start` / `thread.join`, declared supported in framework-zephyr and unsupported in the frozen framework-arduino manifest.
  
  Tier-3 scoping decisions recorded for later: **LEDStrip** is deferred after verifying the pinned Zephyr (4.4) ws2812 bindings — the SPI backend requires per-SoC `spi-one-frame`/`spi-zero-frame` timing symbols (the binding's own docs: "hardware specific tuning is required"), which cannot be derived from construction facts without a per-board verified defaults table. **FS** stays as-is (its surface is already fact-shaped: mount once, path-string verbs over `fs_read`/`fs_write`); **Settings/Power/Random** stay service-shaped per the tier plan.
- fbd0820: Time API — the TypeScript-flavored timing surface, first step of the Zephyr-first HAL (Arduino is frozen on the legacy forms):
  
  - **`Time`** (`@typecad/hal`, hal/time.ts): `Time.sleep(ms)` → `k_msleep` (yielding sleep, `delay()`'s replacement), `Time.now()` → `k_uptime_get()` as a double (ms since boot, no uint32 wrap, `Date.now()`-shaped), `Time.nowUs()` → `k_cyc_to_us_floor64(k_cycle_get_64())`, `Time.busyWaitUs(us)` → `k_busy_wait` (spin, no yield — `delayMicroseconds`'s honest name), plus `Time.freeHeap()`.
  - **New ops** `timing.sleep` / `timing.now` / `timing.now_us` / `timing.busy_wait_us`, declared supported in framework-zephyr and unsupported in the frozen framework-arduino manifest — the sensor precedent (framework-scoped vocabulary) applied to the first HAL family.
  - **Deprecated, still lowering**: `delay`/`millis`/`micros`/`delayMicroseconds`/`freeHeap` module functions and the `Timing` class keep their current lowerings permanently (framework-arduino is frozen, not removed).
  - **Dropped**: `map()` / `constrain()` free functions — Arduino-core macro pass-throughs with no Zephyr-native lowering.
- fbd0820: The async/interrupt tier lands for the thin HAL — the two deliberately-absent surfaces ship:
  
  - **UART RX is interrupt-backed** (`hal/uart-port.ts`): the first receive call arms the driver's IRQ callback (`uart_irq_callback_user_data_set` + `uart_irq_rx_enable`, guarded), and the ISR drains the FIFO into a construction-sized ring — `rxBufferBytes` (default 64) sizes the shim's static buffer, with free-running head/tail counters and drop-on-full (the embedded-honest answer — no unbounded buffering). On that ring, the calls the poll driver honestly could not support now exist: `available()` (bytes waiting), `peek()` (oldest byte without consuming), `read()` (pop, −1 when empty). TX stays poll-based (`uart_poll_out` — synchronous, right for writes). New ops `uart.rx_arm`/`rx_available`/`rx_peek`/`rx_read` (the placeholder `uart.poll_read` is removed); state emission is keyed on the rx ops actually used, so an unused ISR never trips `-Wunused-function`.
  - **`await Time.sleep(ms)` is cooperative**: `Time.sleep` now returns `Promise<void>` — bare calls still lower to the blocking `k_msleep` statement, and inside an `async function` the awaited form rides the SAME state-machine machinery `await delay()` uses (`AWAITABLE_HAL_OPS` + a pure-deadline `netWaitInfo` entry: the coroutine arms `_waitUntil` and yields while timers and other tasks run).
  
  Correction to an earlier misdiagnosis: construction facts (e.g. `rxBufferBytes`) resolve correctly EVERYWHERE — top level, plain function bodies, and coroutine bodies (while-conditions + awaited statements). A first observation of default-valued rings inside coroutines was actually the `_rxEcho`/`_rxBufferBytes` field-name mismatch in the same change window, not an async-machinery limitation; a dedicated regression test now pins the coroutine shape (ring at the construction size inside `while (gps.available() < 1) { await Time.sleep(50); }`).
  
  Also: the esp32s3 chip descriptor now declares its user buses (`uart1` with the binding-required pinctrl + current-speed, `i2c0`, `spi2`/`spi3`), mirroring @typecad/board-esp32s3's verified facts — the registry fallback previously had none, so UART/bus e2e tests could not run against the default esp32s3 test target. The ring e2e now runs on that chip. Docs updated (`docs/hal/thin-hal.md`): both entries moved out of "deliberately not here" into their sections with the honest semantics.
- a9bcb6e: ## USB CDC-ACM serial HAL (`USB0`)
  
  The reserved endpoint-level `usb.*` op surface (usb.init/write/read with
  endpoint indices, never implemented) is replaced with a **class-level,
  serial-shaped** surface matching Zephyr's "next" USB device stack, where
  composition is devicetree's job and a CDC-ACM instance is just a UART device:
  
  ```ts
  import { USB0 } from '@typecad/board';           // board with a USB port
  
  USB0.begin(115200);                               // usb_enable() + line coding
  USB0.println("hello over the connector");
  if (USB0.connected()) { ... }                     // DTR — host opened the port
  ```
  
  - **`@typecad/hal`**: new `USBSerialPort` class (`begin/end/print/println/
    printf/write/read/available/flush/connected/waitForConnection`) exported
    alongside `SerialPort`.
  - **`@typecad/cuttlefish`**: `usb.*` HAL ops reshaped to the serial form
    (port-identified, like `uart.*`); `USB0`/`USBn` receivers resolve like
    `UART0`; new `usesUsb` program-analysis flag.
  - **`@typecad/framework-zephyr`**: `lowering/usb.ts` lowers the ops against
    `DT_NODELABEL(cdc_acm_uart<N>)` with the same per-byte `uart_poll_out`
    loops as uart; `begin` guards a one-shot `usb_enable()`; `connected` polls
    `UART_LINE_CTRL_DTR`. The overlay enables the board's UDC controller
    (`zephyr_udc0`) and composes the declared number of `cdc-acm-uart` class
    instances; prj.conf gains `CONFIG_USB_DEVICE_STACK_NEXT`,
    `CONFIG_USBD_CDC_ACM_CLASS` and `CONFIG_UART_LINE_CTRL` (Zephyr 4.3
    symbol names, verified against `subsys/usb/device_next/Kconfig`) — all
    usage-gated, so a program that touches no USB emits none of it. The shim
    emits the full next-stack device context (`USBD_DEVICE_DEFINE` + string
    descriptors + `USBD_CONFIGURATION_DEFINE` + `usbd_register_all_classes` +
    one-shot `usbd_enable`), with VID/PID overridable via `zephyr.usb.vid/pid`
    (Zephyr-test defaults `0x2fe3/0x0001`). Boards declare the capability via
    `zephyr.usb: { controller, cdcInstances }` in the board package; ops on a
    board without it fail with a clear diagnostic.
  - **`@typecad/board-blackpill-f411ce`**: declares `zephyr_udc0` (OTG_FS on
    PA11/PA12, one CDC instance) and exports `USB0` — `USB0.println` now goes
    out the USB-C connector while `UART0`/`console.log` stay on USART1
    (PA9/PA10). The zephyr-blackpill demo reports its mode + sense voltage
    over USB CDC as the hardware canary.
  - The xiao_ble chip descriptor (the framework's default) also declares its
    nRF52840 native USB, so `USB0` works there too.
  - **STM32F4 SWD recovery**: every STM32F4 build now sets the DBGMCU
    DBG_SLEEP/DBG_STOP/DBG_STANDBY bits at boot (emitted `SYS_INIT` +
    `CONFIG_STM32_ENABLE_DEBUG_SLEEP_STOP`). Without them the core's debug
    port is gated during WFI idle and openocd cannot examine or halt the
    running target — "Failed to read memory at 0xe000ed04" — leaving
    BOOT0-bootloader entry as the only way back in on boards without an RST
    pad (the Black Pill). Also adds a `stlink-srst` probe method
    (connect-under-reset) for setups that do wire SRST.
  - **STM32 PWM 16-bit fix**: slow PWM periods (the 20 ms servo convention)
    overflow the timers' 16-bit ARR at ÷1 prescaler and `pwm_stm32` rejected
    them ("period cycles exceeds 16-bit timer limit"). The chip descriptor
    now carries the timer input clock (`zephyr.pwm.clockHz`), and the overlay
    generator derives the smallest `st,prescaler` on the timers node that
    fits the slowest used period (blackpill TIM4 @ 96 MHz, 20 ms → ÷30).
  - framework-arduino keeps usb unsupported (no USB device stack on
    AVR/SAMD cores) with an updated per-op declaration.
- fbd0820: USBConsole and Store join the thin HAL — the Arduino-Serial console and the
  NVS session model are replaced by fact-carriers with Zephyr verbs.
  
  `new USBConsole('USB0')` carries the CDC instance; `open()` starts the USB
  device stack (the baud parameter is gone — CDC line coding is the host's
  business); `write()/writeLine()` take typed string|number (the `any`-typed
  print/println/printf family and the `usb.printf`/`usb.write` ops are
  removed); `ready()` is the DTR query; `waitReady(timeoutMs)` is a NEW op —
  one bounded DTR poll with k_msleep slices in the lowering, replacing the
  TS busy-loop `waitForConnection`; `read()/available()` keep their poll
  semantics. `close()`/`usb.flush` are observable no-ops (flush op removed).
  
  `new Store('app')` carries the namespace as the construction fact; the
  begin(name, readOnly)/end() session dance is gone along with the
  `preferences.begin`/`end` ops — every op now composes its full settings
  name (`tc/<ns>/<key>`) at emit time, and the shim's begin-time prefix
  state is deleted. Four typed pairs (Int/Float/Bool/String — the UInt pair
  and its ops are removed; both were 4-byte writes) plus remove(key) and
  clear() over the namespace. Get defaults are REQUIRED parameters — the
  implicit `= 0` magic values are gone. The transformer captures the
  namespace like every other thin-class fact, and put values accept runtime
  expressions (`store.setInt('n', store.getInt('n', 0) + 1)` lowers).
  
  Two real persistence bugs fixed in the ZMS shim, found by the new
  cross-flash hardware test:
  - `settings_subsys_init()/settings_load()` were only reachable through the
    deleted `begin()` — every put/get silently ran against the RAM cache and
    nothing ever hit flash. All entry points now mount lazily.
  - The `h_set` load callback stashed names relative to the handler's "tc"
    subtree ("rig/marker") while lookups use full names — loaded entries
    never matched, so values never survived a reboot even once flash writes
    worked. The subtree prefix is re-attached at load.
  
  Hardware-verified on the ESP32-S3 (new `store.test.ts` in the hal rig):
  all five typed round-trips pass against the real settings/ZMS backend, and
  the marker key demonstrably survives re-flashing the application — written
  through ZMS to the storage partition at 0x3b0000, read back on the next
  flash (verified by consecutive green rig runs and a raw esptool dump of
  the partition). All USBConsole consumers (2 mcu packages, 5 boards'
  pins.ts) are migrated to the new class name.
- fbd0820: WiFi joins the thin HAL: the Arduino-ESP32-style singleton is replaced by
  fact-carrying station/AP classes.
  
  The new `WiFi(ssid, opts)` carries the link policy at construction — psk,
  security (WiFi.OPEN/WPA2/WPA3/WPA2_WPA3 tokens, defaulting from the psk),
  band, channel, join timeout, powerSave (PS_OFF), and static ipv4 facts
  (addr/gateway/netmask, applied via net_if instead of DHCP — previously
  unsupported). `join()` associates from those facts through net_mgmt and
  bounded-waits on the L4 connected flag, returning a boolean (no exceptions);
  `joinStart()` stages the association for polling or the async split;
  `leave()/linked()/rssi()/ip()/mac()/onUp()/onDrop()` map 1:1 onto the
  existing iface-status/net_if/event surfaces. `scan()` returns a `Scan`
  handle over the fixed 16-entry pool (count/ssid/rssi/channel/security).
  `WiFiAP(ssid, {psk, channel})` carries the SoftAP facts with start()/stop().
  
  Removed: the fat 34-method surface — connect/connectAsync/untilConnected/
  untilDisconnected/waitConnected/waitDisconnected pairing, the setter dance
  (hostname/staticIP/autoReconnect/powerSave/txPower), AP setters, and the
  unsupported credentials trio (17 op kinds deleted end-to-end; wifi.join is
  the new fact-carrying kind). The async machinery splits awaited wifi.join
  into connect_start + the L4 poll.
  
  The Zephyr shim's join applies static IPv4 via net_if_ipv4_addr_add +
  set_netmask_by_addr (the old set_netmask is __deprecated) + set_gw, and the
  PS_OFF fact through the modern wifi_ps_params shape. The instance
  transformer captures WiFi construction facts (ssid/opts/ipv4) like the other
  thin classes. wifi-demo's 11 programs are migrated and the demo west-compiles
  clean for esp32_devkitc (requires `west blobs fetch hal_espressif` once).
  
  Hardware-verified on an ESP32-S3 devkitC: the new
  framework-zephyr/hal/esp32s3/wifi.test.ts joins a real WPA2 network from
  construction facts (association + DHCP in ~5s), reads back ip/rssi/mac,
  scans the neighborhood through the pool handle, and leaves — 15/15 rig
  tests green alongside the core HAL suite. Fixes made on the way: absent
  WiFi facts now carry "undefined" sentinels the plugin strips (previously
  leaked as raw `this->_field` text), and the SPI transceiver unwraps the
  nullish-lowered `rx ?? new Uint8Array(0)` default to the caller's buffer
  identifier.
  
  Known follow-ups surfaced by compiling the demo and rig: (1) pre-existing async
  generator bug — a HAL-op statement immediately before an await renders as a
  bare `{` (demo 03's heartbeat works around it); (2) awaited instance methods
  rebind the inlined class body's `this` to the generated task class, so
  awaited wifi.join() inside async bodies is staged-join + poll for now;
  (3) a Uint8Array rx buffer passed to SPITarget.transceive is consumed
  opaquely by the op resolver — its declaration tree-shakes out of the
  generated C++ (the empty-bus rig test uses the write-only form until the
  buffer path lands).
- fbd0820: Remove the Arduino wiring-compat layer and migrate the runtimes onto a
  thin-HAL clock contract.
  
  Wiring compat deleted: the Zephyr strategy no longer detects or shims bare
  wiring calls — pinMode/digitalWrite (and the INPUT/OUTPUT/INPUT_PULLUP/
  HIGH/LOW #defines they needed), pulseIn/pulseInLong (__tc_wiring_pulse_in),
  and the bare shiftOut/shiftIn shims are gone; the ambient detector now only
  carries the live APIs (random/randomSeed, noInterrupts/interrupts). The
  free-function pwmWrite/tonePlay/toneStop/wdtEnable/wdtReset/httpSendStart
  stubs and their plugin cases are removed, and with them the orphaned
  pwm.write, tone.play and tone.stop op kinds end-to-end (IR union, kinds
  registry, lowering, manifest, peripheral-usage, capability/validation arms).
  http.send_start stays — the async state machine produces it directly for
  awaited HTTP. Pin-capability and mode-validation now key on the thin
  pwm.set_pulse/set_duty/set_period/tone ops.
  
  safety: the pin-mode intercept is rebuilt on the thin HAL — v3 scans
  gpio.configure/gpio.read_cfg flag tokens (pure token lists only; runtime
  expressions record Unknown; open-drain counts as Output) and injects the
  same safety.record_pin_mode companion, so safe.read's mode verification
  works again on thin-HAL programs.
  
  Runtime clock contract: millis() is replaced by __tc_now_ms() — Zephyr
  defines it as k_uptime_get_32(), native as a steady_clock count, and the
  async/promise runtimes, cooperative scheduler, and the UI per-frame tick
  all lower onto it via currentTimeMillis(). The micros/map/constrain shims
  and their gating machinery are deleted. The UI runtime header now declares
  the clock extern and carries its own __ui_constrain clamp instead of
  calling the Arduino-named helpers; the byte-identity baseline is
  regenerated. Programs that can never read the clock get the definition
  stripped from the emitted header.
- fbd0820: ## Workspace consolidation: safety + framework-native into cuttlefish, zephyr-installer into framework-zephyr
  
  Three first-party packages were merged into their consumers, shrinking the
  published surface from ten packages to seven.
  
  - **`@typecad/safety` → built into `@typecad/cuttlefish`.** The engine
    (pin-mode intercept pass, ISO 26262 analysis, runtime polyfills, sidecar
    writer) now lives in cuttlefish under `src/safety/` and registers directly —
    the dynamic-import bridge and the optional peer dependency are gone. The
    authoring surface is exported as `@typecad/cuttlefish/safety`; the legacy
    `@typecad/safety` import specifier still activates safety (detection is by
    name, no module resolution). `SafeVariable`/`SafeInt`/`safe` and the ISO
    26262 sidecar are unchanged.
  - **`@typecad/framework-native` → built into `@typecad/cuttlefish`.** The
    native desktop target (g++/clang++ strategy, toolchain, terminal preview)
    lives in cuttlefish under `src/frameworks/native/` and is resolved directly
    by the framework loader — configs keep `framework:
    '@typecad/framework-native'` unchanged. `cuttlefish create` for native
    targets no longer adds a separate framework dependency to scaffolded
    projects (the capability ships with cuttlefish itself).
  - **`@typecad/zephyr-installer` → bundled with `@typecad/framework-zephyr`.**
    The micromamba/SDK/west installer moved to `framework-zephyr/installer/`
    with its `zephyr-installer` and `typecad-zephyr-install` bins intact. The
    one-shot invocation is now `npx --package @typecad/framework-zephyr
    zephyr-installer`; in projects that depend on framework-zephyr, plain
    `npx zephyr-installer` keeps working.
  
  Existing projects are unaffected: all three historical config strings and
  import specifiers still resolve, and the previously published packages remain
  installable from the registry (frozen at their last version).
- 5c731c3: ## bossac on Windows
  
  `west flash` on SAM-DA-bootloader boards (SAMD — the Arduino Nano 33 IoT,
  Zero, MKR series) uses the bossac runner, and bossac ships in nothing Zephyr
  provides: not the SDK bundle, not a west module, not conda-forge. Zephyr's
  FindHostTools also resolves `find_program(BOSSAC)` at build-configure time,
  so a missing binary bakes `BOSSAC-NOTFOUND` into the runner args and the
  flash dies with "required program bossac not found" — installing bossac
  afterwards requires a re-configure to take effect. install.ps1 now extracts
  the official upstream BOSSA MSI (SHA256-pinned in versions.env) with the
  env's 7z and drops its self-contained bossac.exe (system DLLs only) into
  the env's Library\bin — on the activation PATH and on the PATH of the
  `micromamba run` west flash the framework spawns. Idempotent;
  warn-and-continue (only affects SAM-BA boards). install.sh prints per-OS
  install hints on POSIX (apt bossa-cli, brew bossa).
- a9bcb6e: ## dfu-util on Windows + pyusb in the env
  
  - **dfu-util (Windows).** `west flash` on USB-DFU boards (the STM32 ROM
    bootloader — e.g. the Black Pill) shells out to dfu-util, and a missing
    executable dies with a raw `FileNotFoundError`. conda-forge has no
    dfu-util build, so install.ps1 now fetches MSYS2's mingw64 dfu-util
    package plus its libusb/libwinpthread DLLs (SHA256-pinned in
    versions.env) into the env's `Library\bin` — on the activation PATH and
    on the PATH of the `micromamba run` west flash the framework spawns.
    Idempotent; warn-and-continue on failure. install.sh prints the per-OS
    install command on POSIX instead (no auto-sudo).
  - **pyusb.** west's runner registry imports every flash runner; `rtsflash`
    wants `import usb`. Without pyusb every west build/flash prints a
    "runner could not be imported" warning — now in environment.yml for all
    platforms.

### Patch Changes

- fbd0820: Complete the legacy-HAL removal: delete the dead op/stub chain and the
  Arduino-era API surface.
  
  hal: 48 editor-facing emit stubs deleted — the i2c wire-dance, spi manual-CS,
  uart print/stream family, rmt, tone free functions, pulseIn, gpioSetMode,
  adcReadVoltage/adcSetReference, getMicros and httpSendStart leftovers whose
  op families no longer exist end-to-end. The Arduino digital constants
  (HIGH/LOW/INPUT/INPUT_PULLUP/…/LED_BUILTIN, LSBFIRST/MSBFIRST) and the AVR
  WDTO_* presets are removed; WDTClass (superseded by the thin Watchdog) is
  deleted. USBSerialPort stays — mcu packages depend on it.
  
  cuttlefish: the 10 legacy uart.* stream op kinds, their plugin cases,
  peripheral-usage arms, probe payloads and union members are gone, along with
  the 9 never-manifested spi.begin_transaction/cs_low/set_mode/read_buffer/
  shift.in/out kinds — a manifest audit confirmed every remaining op kind is
  declared by framework-zephyr (ble/eth/mdns/ota/twai are declared
  programmatically). The framework registry drops @typecad/framework-arduino;
  the inert avr/megaavr/esp8266 rows in the polyfill stdlib-support table, the
  avr entry in the radioless-architecture set and the heap-analysis AVR size
  note are pruned.
  
  safety: AnyPin collapses to the thin GPIO type now that InputPin/OutputPin
  no longer exist in hal.
  
  boards: board-esp32-devkit/c3/c6/s3/rp2040/rp2350 drop ARDUINO_CORE_VERSION,
  their `build.frameworks.arduino` FQBN entries and the ARDUINO* defines — the
  Zephyr build target remains the only declared one.
  
  docs/demo hygiene: docs/arduino-cli-environment-check.md is deleted; the
  framework authoring guide now references ZephyrStrategy and framework-zephyr
  end-to-end; thin-hal.md corrected (the Arduino-named surface is removed, not
  frozen); demo-shadcn's vendored Adafruit library trees are removed (verified
  unused); the debug-extension README source is rewritten for console-based
  targets and re-propagated to all demo copies.
- fbd0820: Dead-code cleanup from the Zephyr-first pass:
  
  - **Dropped the fluent map/constrain chains** — `MapChain`/`ConstrainChain`, `Num.map(x).from(a,b).to(c,d)`, `Num.constrain(x).between(l,h)`, and the corresponding `__tc_Num` polyfill members in both framework strategies. Nothing used them (verified across hal/frameworks/tests/demos), and they were the fluent form of the `map()`/`constrain()` vocabulary already dropped from the user surface. `Num.abs/min/max` and the free trio stay (bare-call polyfills on every framework), and the `usesMap`/`usesConstrain`-gated free-function polyfills stay — the UI runtime's generated draw code calls them.
  - **Stale comment fixes**: the three hal-side comments still naming `pwm_set_period_dt` (removed from the lowerings when the hardware run proved Zephyr 4.4 has no period-only setter) now describe the real `pwm_set_dt` behavior.
  - **Test hygiene**: the hal expect dry-run suite restores the module-global chip descriptor in `afterAll` (the blackpill run repointed it, leaking into test files sharing a vitest worker).
  
  Known issue recorded (not introduced here): combining the hal-resolution directory with the expect suite in one cold parallel vitest run intermittently yields an empty transpile output file (`.build/tests` write race under cold workers) — the suites pass consistently when run as separate vitest invocations. Follow-up: per-file output dirs or sequential config for the e2e group.
- fbd0820: Demo sweep — every Zephyr-targeted demo now runs on the thin HAL (legacy timing/GPIO/PWM/ADC classes gone from the converted set; Arduino demos stay frozen by design):
  
  - **`zephyr-blackpill`** — the showcase dimmer: `GPIO` construction flags on led0/sw0, `ADCChannel(A1).readMillivolts()`, `PWM(PB6, { periodNs })` with `setDuty` fractions (the 0–255 `pwm()` duty and its `/13`, `/7` scale arithmetic are gone), `Time.sleep` throughout. Sensors, USB0, and the `I2C0/SPI0.device()` constructions are unchanged (their sanctioned uses).
  - **`zephyr-nano-33-iot`** — the LED *is* the PWM channel: `new PWM(LED, { periodNs: 20_000_000 })` replaces the `asOutput` + `pwm()` pair on the shared PA17.
  - **`demo-timing`** — rebuilt from the unbuildable aspirational sketch onto the shipped Time API and given a package.json/config/tsconfig so it actually runs: clocks (`Time.now`/`nowUs`), `busyWaitUs`, `setInterval`, and a `Thread` blinking the LED off-main, joined at the end. The emitted output was verified to contain every intended lowering (`K_THREAD_STACK_DEFINE`, `k_thread_create`, `k_msleep(250)` in the thread body, `__tc_setInterval`, `k_uptime_get`, `k_cyc_to_us_floor64`, `k_busy_wait(10)`).
  - **`zephyr-debug`**, **`demo`** (BLE), **`demo-contract-board`**, plus `zephyr-blink`'s `multi.ts`/`ble.ts` side files — mechanical `delay → Time.sleep`, `asOutput/asInput → GPIO`, `readAnalog → ADCChannel.read` conversions. README code blocks updated to match.
  - Drive-by fix: `zephyr-debug`'s config carried the pre-rename display profile id `st7796-spi` → `st7796-zephyr`; the demo had been un-buildable before this.
  
  All converted demos verified with `cuttlefish build` (transpile-clean).
- b943f70: ## Qualify all board targets on Zephyr ≥4.3
  
  Audited every board package's Zephyr target against the v4.4.2 workspace
  (all verified with `west build --cmake-only`): the multi-core ESP32s were
  already qualified at build time by `resolveBoardTarget`, and every
  board-package target configures cleanly. `xiao_ble` and `rpi_pico` still
  relied on Zephyr's bare-name normalization (which works on 4.4 but is
  slated for removal), so they now map to their qualified forms
  (`xiao_ble/nrf52840`, `rpi_pico/rp2040`) in
  `QUALIFIED_TARGETS_GE_4_3` alongside the ESP32s — the framework now
  emits fully-qualified `-b` targets for every supported board on
  Zephyr ≥4.3, while older Zephyr and unknown boards pass through
  unchanged. The manifest's informational targets list is now fully
  qualified as well.
- fbd0820: GPIO.get() bug fix — the blackpill demo's keypress was dead: `if (button.get())` never configured the pin.
  
  - **Root cause**: `GPIO.get()`'s method body emits a `gpio.configure` side-effect op *before* the value-returning `gpio.read` op. In pure expression positions (if-conditions, comparisons), the transpiler's expression resolver keeps only the **last** HAL op of a method body — the leading configure was silently dropped, so PA0 (the KEY button) was never set to `GPIO_INPUT | GPIO_PULL_UP`. With no configure call, the DTS node's own `GPIO_PULL_UP` dt-flag never applied either (dt flags ride the configure), and the WeAct KEY circuit has no external pull-up — the pin floated and the button read noise. Statement contexts (the expect preprocessor hoists calls into `const` declarations) emitted both ops, which is why the hardware HAL test passed while the demo failed.
  - **Fix**: `get()` now lowers through a single fused op — `gpio.read_cfg { pin, flags }` → one statement-expression `({ <guarded configure> gpio_pin_get_dt/get_raw(...); })` — the same fusion pattern the UART RX ops use, correct in every expression context by construction. New op wired through the IR, resolver, usage accounting, both manifest declarations, and both lowering paths (dtSpec + raw).
  - **Regression test** pins the exact failing shape (`if (button.get())` on the sw0 dtSpec asserts the configure-with-pull-up text inside the fused expression).
  - The fixed zephyr-blackpill demo was re-flashed and verified on hardware: `if (({ static bool __tc_gpio_cfg_sw0_done = false; … gpio_pin_configure_dt(&__tc_dt_sw0, GPIO_INPUT | GPIO_PULL_UP); … gpio_pin_get_dt(&__tc_dt_sw0); }))`.
  - Recorded for the ledger: the expression-path op-dropping (`tryResolveHALExpression` — "preceding ones are side effects") is **generic transpiler behavior**, not GPIO-specific — any HAL method combining leading side-effect ops with a value return needs the fusion pattern (or a hoisted statement) in expression contexts. GPIO.get and the UART RX ops now fuse; future value-returning thin methods should follow.
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
- fbd0820: Restore the HTTP/S hardware suite and verify the HTTP client on the thin HAL.
  
  The deleted network test infrastructure is back: server.ts/start-server.ts
  (the LAN HTTP+HTTPS test server with /echo, /status/[code], /headers, and the
  stateful /items CRUD store), certs, http-client.test.ts, and the npm scripts.
  The suite is retargeted at the connected ESP32-S3 (CH34x identity,
  resetAfterOpen) and joins Skynet through the thin WiFi station; the test
  server runs non-interactive via WIFI_SSID/WIFI_PASSWORD env vars.
  
  HttpRequest.send() drops its Promise<boolean> shim — it is a plain blocking
  boolean now (wifi.join discipline; the async machinery's send_start + done
  split is unchanged, and a dead unreachable plugin line is gone).
  
  Hardware-verified on the S3 against the local server: 23/24 asserts green —
  all six verbs against /echo, status-code parsing (404/201/500), the full
  seven-step CRUD state mutation on /items, custom headers, and HTTPS with
  insecure() through the TLS listener. Fixes made on the way: a stale
  CONFIG_MBEDTLS_PEM_CERTIFICATE_FORMAT assignment (symbol no longer exists on
  this tree — it aborted every http Kconfig), and caCert() lowering now decodes
  the PEM to a DER byte array at emit time (this tree's tf-psa-crypto mbedTLS
  has no PEM parser). KNOWN LIMITATION: pinned-CA (verified) TLS still fails at
  connect with EPERM — the tf-psa-crypto symbol matrix needs more than the
  single-ciphersuite select provides, and forcing the RSA public-key symbol
  regressed the insecure path (two hardware cycles proved it upstream).
  Documented in the kconfig block; revisit when the upstream matrix is mapped.
- fbd0820: Fixed: `npx cuttlefish-test` found zero test files when run from a nested suite directory.
  
  `npm exec` resets the spawned command's working directory to the npm *local prefix* — the nearest ancestor with a `package.json`. From a hardware suite dir like `packages/framework-zephyr/hal/esp32s3` (which deliberately has no `package.json` of its own), that lands on the workspace package instead of the project under test, so the CLI's `process.cwd()`-based project root resolved the wrong directory and test discovery came back empty (which previously made a direct `node …/dist/host/cli.js` invocation the only working option). The CLI now resolves the project root through `INIT_CWD` — the directory npm records as the real invocation dir — falling back to `process.cwd()` when it's unset or missing.
  
  The hardware runner (`hal/run.mjs`) repins `INIT_CWD` to the suite dir when spawning the CLI, so `npm run hal` on a board package (which sets `INIT_CWD` to the *board package* dir for the whole process tree) keeps resolving the suite it actually targets.
- 5f587c7: ## West discovery: no DEP0190 on Windows
  
  Every `cuttlefish build --compile --upload` printed Node's DEP0190
  deprecation warning on Windows:
  
  ```
  (node:…) [DEP0190] DeprecationWarning: Passing args to a child process
  with shell option true can lead to security vulnerabilities…
  ```
  
  West discovery spawned `where west` (and probed each `west --version`
  candidate) with both an args array and `shell: IS_WIN` — the exact
  combination DEP0190 flags, since the shell concatenates args unescaped.
  The 1.0.0-alpha.12 pass had already dropped the shell on Linux/macOS but
  kept it on Windows on the assumption that `where.exe` needs cmd.exe to
  resolve. It doesn't: `where` is a plain PE executable that Node resolves
  from PATH, and this module already spawns venv `python.exe` launchers
  shell-less the same way (as does `westSpawn` for launcher-mode installs).
  
  Both discovery spawns are now shell-less on every platform. Discovery
  behavior is unchanged — the cascade still resolves the same installs
  (PATH → `$ZEPHYR_BASE` venv → micromamba → well-known → system Python);
  a regression test now fails if a shell is ever reintroduced into the
  `where`/`which` probe.
- fbd0820: Display on Zephyr — the M3 spike landed: the UI/display stack compiles and links on framework-zephyr, ending the display demos' Arduino-only status.
  
  - **`demos/zephyr-display` (new)** — the Zephyr port of `demo-display`: the same `.ui` showcase entry (scroll viewports, image assets, theme) and the same hardware (ESP32-S3 + ST7796S + FT6336U), built through the framework-zephyr display path — the `st7796-zephyr` profile over `<zephyr/drivers/display.h>` and the strategy-owned FT6336U touch adapter — instead of the Adafruit ST7796S adapter over the Arduino core. **Transpiles and full west-builds clean** (only benign unused-static warnings from dead UI runtime code paths). This is the first UI-framework demo to compile on Zephyr — the rendering-guardrail canary set can now migrate.
  - **`demos/zephyr-debug`** — verified to full west-build with its ST7796S + touch config (the existing minimal display-on-Zephyr demo, previously only transpiled).
  - **Touch wiring fixed in both**: the overlay generator's diagnostic ("touch: I2C controller has no sda/scl pins … may never answer") was real — both configs now declare `sda: 8, scl: 9`, the shared demo rig's wiring per demo-st (NOT the esp32s3 board dts's `i2c0_default` of GPIO1/2). The diagnostic no longer fires.
  
  Remaining (mechanical now): porting `demo-ui`, `demo-ui-sd13`, and `demo-shadcn` the same one-config way, and a hardware day to eyeball the showcase on the panel (scrolling guardrails were validated on Arduino SPI TFTs; the Zephyr display runtime needs the same visual pass).
- a9bcb6e: ## Emit correctness: port-relative raw GPIO, macro-safe aliases, per-use gating
  
  Four bugs found by building and flashing real hardware, plus a dead-code
  rule the emitter now enforces:
  
  - **Raw GPIO uses port-relative indices.** `gpio_pin_*_raw()` addresses the
    index within the controller, not the global pin number. Every raw emission
    site (gpio/pulse/spi lowerings, plus a new `__tc_gpio_pin()` runtime
    dispatcher for the pin-watch and safety shims) now emits `pin - minPin`.
    On the XIAO the old form only worked by an nRF absolute-numbering accident
    and tripped the generic layer's `port_pin_mask` assert on assert-enabled
    builds — the descriptor now declares its real gpio0/gpio1 split.
  - **`DT_ALIAS` tokens are macro-safe.** Dashes in DT alias names become
    underscores in Zephyr's generated macros; `DT_ALIAS(pwm-led0)` is a
    subtraction expression and failed to compile. Emitted as `pwm_led0`.
  - **The toolchain resolves chips from the board package.** The compile-time
    overlay regen used the hardcoded registry and silently fell back to the
    XIAO descriptor for board-package chips (emitting `&uart0` on an STM32
    whose node is `usart1`). The transpile now persists
    `board-constants.json` next to the emitted source and the toolchain
    resolves through the same path the strategy uses.
  - **A-pin aliases resolve through the board's analog list.** `A1` fell
    through to the Arduino `A0 = 14` convention and became a random GPIO on
    every non-Arduino board; it now resolves `pins.analog[n]` → port name →
    pin number.
  - **Nothing unused is emitted.** ADC channel setups and PWM specs are gated
    on the pins the program actually touches (deep program-IR walk at emit
    time, source scan at overlay time), so the single generated TU compiles
    with zero `-Wunused-function` warnings and the devicetree carries no dead
    channels.
- dd7fd95: ## Fix selective SDK installs for the 1.0.x `gnu/` layout
  
  SDK 1.0.x installs toolchains under `<sdk>/gnu/` — its cmake resolves
  `TOOLCHAIN_HOME` to `${ZEPHYR_SDK_INSTALL_DIR}/gnu` and its setup.cmd
  installs with `pushd gnu; 7z x`. The selective/`--platforms`/`--modify`
  paths extracted individual toolchain archives at the SDK root (the 0.17.x
  layout), which builds fine against pre-4.4 Zephyr but fails on 4.4+ with
  "Unable to find 'x86_64-zephyr-elf' or any other architecture in
  `<sdk>/gnu`". Both installers now extract into `gnu/` on 1.0.x, migrate
  misplaced SDK-root copies into `gnu/` instead of re-downloading, treat a
  target dir without `bin/` as a hollow leftover (e.g. a failed setup.cmd
  download) and re-download it, and the deselection cleanup scans both
  locations. Also fixes the POSIX installed-toolchain listing to match
  multi-segment xtensa targets (they were never seen as installed, so
  deselection never removed them).
- 027d4b1: Fix a Windows crash at the very end of the install: PowerShell 5.1 treats redirected native stderr (`2>&1`) as a terminating `NativeCommandError` under `$ErrorActionPreference='Stop'`, so pip's live `Running command git clone ...` relay for git-pinned packages (silabs' `cmsis-svd`) aborted the installer mid-requirements even though pip was succeeding. The module pip step no longer redirects stderr (exit codes are the failure signal). Re-running the installer also now re-pins the west manifest revision on an adopted workspace — a pre-existing workspace tracking `main` converged onto the installer's pinned Zephyr tag instead of drifting out of sync with the SDK version it installs.
- fbd0820: Legacy-HAL removal Phase 1a — the remaining Arduino UI demos ported to Zephyr, with three engine bugs the ports surfaced and fixed:
  
  **New Zephyr demos** (each transpiles AND full west-builds for `esp32s3_devkitc`):
  - **`demos/zephyr-ui`** — the framework-zephyr port of demo-ui: the showcase.ui + neobrutalism theme on the shared ST7796S + FT6336U rig. The largest UI program yet compiled on Zephyr — lists, forms, canvases, keyframe animations, navigation.
  - **`demos/zephyr-weather`** — port of demo-weather: the BME688-style weather dashboard with ui.signal bindings + setInterval polling.
  - Scope note: **demo-ui-sd13 is NOT ported** — the ssd1306-zephyr profile deliberately has no CuttlefishGFX mono UI adapter ("direct display.* only" per the manifest), so a `.ui` entry cannot target mono on Zephyr. Porting it means writing that adapter (~1–2 days + hardware validation); recorded as deferred rather than half-shipped.
  
  **Engine fixes the ports forced**:
  1. **Zephyr console lowering** (`framework-zephyr/src/strategy.ts`): multi-arg `console.log('tapped:', i)` lowered to `printk("%s%s%s\n", …)` assuming every fragment was a string — a numeric list-bind index failed `-Wformat` and broke the west build. Now routes through the `__tc_print`/`__tc_println` shim overloads (const char*, double), which accept any rendered scalar without format-specifier coupling; the shim helpers are emitted unconditionally (they were gated on analysis flags absent in pure-UI programs).
  2. **Keyframe-table link collision** (`packages/ui/src/ui-engine/ui-lowering.ts`): modules sharing a stylesheet register identical animation names, so two mounted modules emitted identically-named `static const UIKeyframeStop` arrays into one TU — a hard redefinition error. Keyframe symbols are now namespaced per module (stable path hash) and deduped by animation name within a module; the set-index table references follow.
  3. The `__tc_println` chain emits proper statement separators (first attempt emitted adjacent calls without semicolons — caught by the same west build).
  
  Regression-verified: demo-shadcn, zephyr-display, and zephyr-debug all still build after the engine changes.
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [5f587c7]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies
- Updated dependencies [5f587c7]
- Updated dependencies [fbd0820]
- Updated dependencies [a9bcb6e]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [a9bcb6e]
- Updated dependencies
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
- Updated dependencies [e15fb1c]
- Updated dependencies [a9bcb6e]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [92c1bc6]
- Updated dependencies
- Updated dependencies [e15fb1c]
- Updated dependencies [a9bcb6e]
- Updated dependencies [a9bcb6e]
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
- Updated dependencies [fbd0820]
- Updated dependencies [a9bcb6e]
- Updated dependencies [fbd0820]
  - @typecad/hal@1.0.0-alpha.15
  - @typecad/cuttlefish@1.0.0-alpha.15

## 1.0.0-alpha.14

### Minor Changes

- ## framework-zephyr parity with framework-arduino
  
  Closes the genuine feature gaps where the (newer) Zephyr framework lagged the
  Arduino framework. The two areas Arduino led — a `licenses` subcommand and the
  `dac`/`fs`/`hwtimer` HAL categories — are now closed.
  
  ### `cuttlefish licenses` for Zephyr (was missing entirely)
  
  - **Shared SPDX core** (`@typecad/cuttlefish/api/shared`): extracts the
    framework-agnostic license-detection engine — the SPDX table, marker/alias
    matching (`identifySpdx`), copyleft classification (`classifyRisk`), and the
    LICENSE-file / source-header / manifest resolver (`resolveLibraryLicense`) —
    out of `framework-arduino/src/licenses.ts` into a reusable
    `spdx-licenses.ts`. Arduino is refactored to consume it (its public API and
    tests are unchanged — a non-regressing import-only change).
  - **Zephyr presenter** (`framework-zephyr/src/licenses.ts`): enumerates the
    Zephyr kernel (`$ZEPHYR_BASE`) + the west manifest projects (`west list`)
    and resolves each one's license through the shared core, rendering a
    copyleft-sorted table that mirrors the Arduino presenter. `--strict` exits
    non-zero on any strong-copyleft / unknown dependency; a missing west install
    degrades gracefully instead of crashing. Declared `licenses: { available:
    true }` in the Zephyr manifest and exported as the dispatcher-facing
    `licenses` alias.
    - **Build-based project scope** — unlike Arduino's installed-library
      registry, a Zephyr workspace's west manifest carries *every* vendor HAL and
      library (most unused by any single project). The default scope therefore
      reports only the dependencies the firmware actually links, derived from the
      last `cuttlefish build`'s `compile_commands.json` (a module is listed iff
      one of its sources was compiled — e.g. an xiao_ble/nRF52840 build links
      `hal_nordic` + the kernel, not the other ~60 modules). Without a build,
      only the kernel is shown with a hint to build first; `--all` lists every
      west module. Module LICENSE files are sought under `zephyr/` and `src/`
      subdirs too (e.g. `hal_nordic` ships `zephyr/LICENSE.txt` → BSD-3-Clause).
    - The CLI accepts `cuttlefish license` (singular) as an alias, and the shared
      resolver now matches lowercase/`.rst` LICENSE files (e.g.
      trusted-firmware-m's `license.rst`) using their real on-disk name so it
      works on case-sensitive filesystems.
  
  ### HAL coverage: `dac`, `fs`, `hwtimer` lowerings
  
  These were previously declared unsupported (the Zephyr manifest flagged `dac`/
  `fs` as "not yet wired"); they now lower to native Zephyr APIs, with
  `profileDiagnostics` gates that surface clear errors for misuse on targets
  lacking the peripheral (mirroring the existing ADC/WiFi gating).
  
  - **`dac`** — Zephyr DAC driver (`dac_channel_setup` + `dac_write_value`)
    driven by a new chip-descriptor `dac` field. ESP32 declares its two 8-bit
    channels (GPIO25/26); nRF52840 / ESP32-S3 (no DAC) lower to a comment and
    trip `zephyr-dac-pin-unavailable`.
  - **`fs`** — Zephyr FS API (littlefs on the storage partition). A lazy-mount
    shim (formats on first use) backs `begin`/`read_text`/`write_text`/
    `exists`/`remove`; the scaffold emits `CONFIG_FILE_SYSTEM` +
    `CONFIG_FILE_SYSTEM_LITTLEFS`, and the overlay enables the DAC node / points
    at the storage partition.
  - **`hwtimer`** — Zephyr counter driver: `set_frequency` → top value
    (`counter_freq/hz`) + `on_overflow` callback, `start` arms both, `stop`
    halts. A new `hwtimer.controllers` descriptor field maps the instance index
    to a counter nodelabel (nRF RTC1; RTC0 is kernel-owned). The JS
    `setInterval`/`setTimeout` `k_timer` polyfill is unaffected.
  
  ### Coverage the manifest validator confirms
  
  The manifest declares `dac`/`fs`/`hwtimer` `supported` and the validator probes
  each op against the resolver — all now lower. The new categories join the
  `halResolutionTests` snapshot suite (`dac.test.ts` rewritten; `fs.test.ts`,
  `hwtimer.test.ts` added) and the shared SPDX core has its own focused test.
  
  ### No-STL string/array polyfills (compile gap)
  
  Zephyr is a no-STL target (`hasVector`/`hasString = false`), like AVR — but it
  was missing the two polyfills AVR ships, so programs using string methods or
  dynamic arrays emitted undefined symbols and failed to compile. Two fixes:
  
  - **Polyfill definitions** — `generateNativePolyfills` now emits a STL-free
    `static_array` (`__tc_StaticArray<T,N>`, mutated/struct array literals + array
    methods) and `string_methods` (`__tc_toUpperCase`/`__tc_endsWith`/… `const
    char*` helpers, inline ASCII case conversion so only `<cstring>` is needed).
    Both are declared in `nativePolyfills()` and the manifest's `polyfills.emitted`.
  - **String-method rewrite** — `normalizeRawExpression` now calls
    `applyStringMethodRewrites` (Arduino always did; Zephyr omitted it), so
    `s.toUpperCase()` lowers to `__tc_toUpperCase(s)` and `s.includes(x)` to
    inline `strstr(...)` instead of a member call on `const char*`.
  
  Verified end-to-end: a program using `s.toUpperCase()` / `s.includes()` /
  `let a = [...]; a.push(...)` now transpiles + compiles for `xiao_ble` (the
  emitted `__tc_StaticArray<double,3>` + `__tc_toUpperCase(s)` resolve). Covered by
  `tests/packages/framework-zephyr/polyfills.test.ts`.
  
  ### Monochrome OLED display (SSD1306) + direct-display fix
  
  Closes the display-driver coverage gap (Arduino ships `ssd1309`; Zephyr now
  ships `ssd1306-zephyr`), skipping e-ink. Two coupled changes:
  
  - **Direct-display bug fix** — `gfx.ts` (the `display_*` runtime for direct
    `display.*` HAL ops, no `@typecad/ui`) was dead code: `shimLines` gated it on
    `!providesDisplayAdapter()`, which is always `true`, so it was never emitted —
    leaving *every* direct-display program (ili9341/st7796 included) with five
    undefined symbols. The gate now uses the per-program UI signal
    (`usesDisplay && !entryHasUI()`), so the runtime is emitted only when no UI
    adapter (which defines the same `display_init`) will be.
  - **Mono GFX runtime** — `buildDisplayRuntime` now branches on
    `profile.colorFormat`: RGB565 keeps the one-row line buffer; **mono** uses a
    full page-framebuffer (the standard model for page-buffered OLEDs; the
    AGENTS.md "no full framebuffer" guardrail targets RGB SPI TFTs, not OLEDs)
    with Zephyr MONO01 packing (horizontal, MSB-first). `display_fill_rect`/
    `draw_rect`/`draw_text` set bits (`color != 0 ⇒ lit`); `display_flush` pushes
    the whole buffer via `display_write`.
  - **Profile + adapter guard** — new `ssd1306-zephyr` profile (128×64 mono); the
    RGB565/SPI UI adapter declines mono drivers (mono is direct-`display.*` only —
    full `@typecad/ui` CuttlefishGFX rendering on mono OLED is out of scope).
  
  Caveat: there is no OLED fixture/demo in the repo, so mono rendering is
  validated at the C++-string level (snapshot tests in `display/gfx.test.ts`,
  same bar as the existing `gfx.ts`); the MONO01 bit orientation is isolated to
  `__tc_set_pixel` for a trivial hardware-reveal fix. Manifest + 422-test
  framework-zephyr suite pass.
  
  ### Intentional differences (unchanged)
  
  The optional strategy-method differences (`mapPeripheralIdentifier`,
  `isrUnsafeOperations`, `setupInitCode`, library resolution, profile/cli-metadata
  probing) remain deliberate platform divergences — Zephyr resolves pins through
  chip descriptors, uses `printk` over a DT-chosen console (no `Serial.begin`),
  and has no Arduino-library registry. `snprintf` stays unsupported by design
  (raw escape hatch).
- ## Zephyr doctor parity with framework-arduino
  
  Brings `cuttlefish doctor` (Zephyr) to feature parity with the Arduino
  framework's doctor, which checks the build tool is installed and the board
  support is present. The Zephyr doctor now performs the same two checks through
  a new shared, structured `checkZephyrEnv()`:
  
  - **west toolchain probe** — verifies `west` (the Zephyr build tool) is
    discoverable + responsive (the direct analog of `arduino-cli` presence) and
    reports the discovered version + source. Previously the doctor only read the
    Zephyr RTOS `VERSION` file and never confirmed the actual build tool worked.
  - **board-support check** — verifies the configured board target exists in the
    Zephyr checkout (`$ZEPHYR_BASE/boards/`), the analog of the Arduino
    `arduino-cli core list` check, and prints a `west boards` hint when it is
    missing. Previously the doctor only previewed how the target string
    normalizes.
  - **`checkZephyrEnv()`** — a structured result (`{ ok, reason, messages,
    fixCommand, check }`) mirroring `@typecad/arduino-cli`'s `checkArduinoEnv`,
    with failure precedence `west-not-found` → `zephyr-out-of-range` →
    `board-not-supported`. `doctor.ts` is now a thin presenter over it so the
    detection logic can be reused by the build/test gates. The existing
    compat-range check and board-target normalization preview are preserved.
- ## Incremental builds: stop deleting the build dir after every successful build
  
  `cuttlefish build` used to nuke `build/` whenever a previous build existed, so
  every build was a full pristine configure + recompile of every Zephyr library
  object — minutes for the larger demos (demo-shadcn: ~280 ninja targets, 69s of
  parallel compile wall time, redone on every build). The build dir is now reused:
  a code-only edit recompiles the changed app translation units and re-links.
  
  The nuke existed to dodge a Zephyr 4.3.99-dev regression
  ([zephyr#104757](https://github.com/zephyrproject-rtos/zephyr/issues/104757),
  fixed upstream 2026-03-03 by the
  [#104784](https://github.com/zephyrproject-rtos/zephyr/pull/104784) revert, in
  v4.4+): after CMake re-runs from a `.config` change, `.ninja_deps` records an
  `offsets.h -> offsets.c.obj -> offsets.h` cycle and every later ninja run fails
  with `dependency cycle`. That bug only fires on a Kconfig/config change — never
  on a plain source edit — so the build dir is now deleted only when the generated
  `prj.conf`/`CMakeLists.txt` content actually changed, and a failed build whose
  output carries the `dependency cycle` signature self-heals with one pristine
  retry (covering any reconfigure path on pre-fix Zephyr snapshots). Board
  switches need no special handling: `west build`'s default `--pristine=auto`
  recreates the dir itself when `-b <board>` mismatches the cached board.
  
  Also: the generated `CMakeLists.txt` now lists the emitted sources explicitly
  via `target_sources` instead of `file(GLOB … CONFIGURE_DEPENDS …)` — the glob
  put a `cmake.verify_globs` step in the ninja graph that spawned CMake to
  re-check the glob on every build. The scaffold rewrites `CMakeLists.txt`
  (unchanged bytes → no write) whenever the emitted file set changes.
- ## Activation-free builds: discover the @typecad/zephyr-installer micromamba env
  
  `cuttlefish build` no longer requires `micromamba activate zephyr` first. The
  west discovery cascade gains a new strategy that finds the micromamba env created
  by `@typecad/zephyr-installer` (via `$MAMBA_ROOT_PREFIX/envs/<name>` or
  `~/micromamba/envs/zephyr`), and `westSpawn` invokes west through
  `micromamba run -n <env> west …`. That sets up the env's full PATH
  (cmake/ninja/dtc) AND runs the activation hook (`ZEPHYR_BASE` /
  `ZEPHYR_SDK_INSTALL_DIR`), so a fresh `cuttlefish build` works in any project —
  new or existing — with the user never activating.
  
  Cascade order is now: PATH → `$ZEPHYR_BASE` → **micromamba env** → well-known
  venvs → system python. The installer env is the managed default when nothing is
  activated; an activated env (PATH) or explicit `$ZEPHYR_BASE` still takes
  precedence. Discovery is file-check based (no spawn) so it adds no per-build
  latency. Env name defaults to `zephyr` (`TYPECAD_ZEPHYR_ENV` override).
  
  This composes with the per-project auto-activation template
  (`packages/zephyr-installer/templates/project/`) for the user's interactive
  shell: builds need no activation; the shell can still be wired via the template
  for `west`/`gdb`/serial use.

### Patch Changes

- Updated dependencies [d3f7b37]
- Updated dependencies
- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.14

## 1.0.0-alpha.13

### Minor Changes

- 95c3692: ## Incremental builds: stop deleting the build dir after every successful build

  `cuttlefish build` used to nuke `build/` whenever a previous build existed, so
  every build was a full pristine configure + recompile of every Zephyr library
  object — minutes for the larger demos (demo-shadcn: ~280 ninja targets, 69s of
  parallel compile wall time, redone on every build). The build dir is now reused:
  a code-only edit recompiles the changed app translation units and re-links.

  The nuke existed to dodge a Zephyr 4.3.99-dev regression
  ([zephyr#104757](https://github.com/zephyrproject-rtos/zephyr/issues/104757),
  fixed upstream 2026-03-03 by the
  [#104784](https://github.com/zephyrproject-rtos/zephyr/pull/104784) revert, in
  v4.4+): after CMake re-runs from a `.config` change, `.ninja_deps` records an
  `offsets.h -> offsets.c.obj -> offsets.h` cycle and every later ninja run fails
  with `dependency cycle`. That bug only fires on a Kconfig/config change — never
  on a plain source edit — so the build dir is now deleted only when the generated
  `prj.conf`/`CMakeLists.txt` content actually changed, and a failed build whose
  output carries the `dependency cycle` signature self-heals with one pristine
  retry (covering any reconfigure path on pre-fix Zephyr snapshots). Board
  switches need no special handling: `west build`'s default `--pristine=auto`
  recreates the dir itself when `-b <board>` mismatches the cached board.

  Also: the generated `CMakeLists.txt` now lists the emitted sources explicitly
  via `target_sources` instead of `file(GLOB … CONFIGURE_DEPENDS …)` — the glob
  put a `cmake.verify_globs` step in the ninja graph that spawned CMake to
  re-check the glob on every build. The scaffold rewrites `CMakeLists.txt`
  (unchanged bytes → no write) whenever the emitted file set changes.

### Patch Changes

- @typecad/cuttlefish@1.0.0-alpha.13

## Unreleased

- **Tearing-effect (TE) hardware sync, opt-in via
  `display.tearingEffectPin` in cuttlefish.config.ts.** Few off-the-shelf
  display boards break the TE pad out, so the option is strictly opt-in:
  when set, the DT overlay emits `te-gpios` on the display node and the
  adapter configures a rising-edge GPIO interrupt on the panel's TE output,
  raises TEON (0x35, vsync mode), and panel updates arm on the frame pulse
  (tear-free writes, no MISO readback) with a bounded wait so a stuck TE
  line can never hang the UI loop. Unwired projects compile exactly as
  before (`__TC_TE_SYNC 0`).

- **All runtime support code is now gated on actual use.** A minimal
  LED-toggle program previously carried ~45 lines of dead shim: the
  `digitalRead`/`HIGH`/`LOW` wiring macros, `millis()`/`map()`/
  `constrain()`, the `__tc_print`/`__tc_println` test-runner helpers, the
  nullish macro + helpers, `__tc_gpio_dev`/`__tc_gpio_read`, every
  board devicetree spec, and `<cstdio>`. Each piece now emits only under
  its own usage signal: `usesMap`/`usesConstrain` (the setup emitter
  already ORs `entryHasUI()` into constrain for the UI runtime's draw
  path), a new `usesWallClock` flag for `millis()` (true millis/micros
  references only — deliberately excluding the `delay()` conflation
  `usesMillis` carries for AVR, since Zephyr's delay lowers straight to
  `k_msleep`; hidden pollers — async, timers, a mounted UI — still keep
  `millis()` alive), `usedPolyfillHelpers` tracking for the expect
  print helpers, and `usesDigitalRead || programUsesSafety ||
entryHasUI()` for the GPIO-read surface. Devicetree specs emit per
  referenced pin (`__tc_dt_<alias>` keyed off the structured `gpio.*`
  hal-op pins), OUTSIDE the single `CUTTLEFISH_SHIM_DEFINED` guard and
  behind per-symbol guards — per-file pin sets differ, and a TU-wide
  guard would keep only the first header's specs in a multi-header TU.
  `<cstdio>` drops unless something printf-shaped is used (expect
  helpers, raw printf/snprintf, the fs/preferences/uart shims). The whole
  shim block is omitted when empty, so a blink program now compiles to
  includes + the `main()` bridge + user code. Capability queries (no
  analysis present) keep the previous always-emit behavior.

- **Fixed: `gpio.toggle` emitted a nonexistent Zephyr API.** The GPIO
  lowering emitted `gpio_pin_toggle_raw(...)`, but Zephyr's toggle API has
  no `_raw` variant (only get/set do) — any program using `.toggle()` on a
  Zephyr target failed to compile with "'gpio_pin_toggle_raw' was not
  declared in this scope". It now emits `gpio_pin_toggle(...)`, the
  driver-level atomic toggle (for pins without `GPIO_ACTIVE_LOW` the
  logical level equals the physical one). Surfaced by the first compile of
  the zephyr-debug starter sketch.

- **Create-time starter debug artifacts (`writeProjectDebugArtifacts`).** The
  package now exports `writeProjectDebugArtifacts({ workspaceRoot,
buildTarget })`, invoked by `cuttlefish create` for freshly scaffolded
  projects: gdb-capable targets (esp32s3) get `.vscode/launch.json` +
  `tasks.json` + `src/out/.cuttlefish/openocd.cfg` immediately, so F5 in VS
  Code works before the first build (the preLaunchTask builds + flashes, and
  that `--debug` build re-merges the same launch entry with the
  CMakeCache-resolved gdbPath). printf targets (xiao_ble, esp32) no-op.
  `resolveGdbPath` also gained a create-time fallback that probes
  `$ZEPHYR_SDK_INSTALL_DIR`, the zephyr-installer micromamba layout
  (`<MAMBA_ROOT_PREFIX | ~/micromamba>/zephyr-sdk/zephyr-sdk-*`), and
  standalone `~/zephyr-sdk-*` roots (newest first) when no build cache exists.

- **`BUILT_IN_PROFILES` export (shared shape).** The DT-binding profiles
  are now exported from `display/` pre-mapped to the shared `DisplayProfile`
  shape — the same interface framework-arduino's displays modules use. The
  strategy's `getProfileRegistry()` and the preview's profile-registry
  loader both consume it, removing the duplicated Zephyr-side mapping from
  `@typecad/ui`'s preview builder.

- **Build-time warning: I2C touch controller with no bus pins.** An I2C
  touch config (e.g. FT6336U) without `touch.sda`/`touch.scl` generates an
  overlay that enables the bus but assigns it no pins — every I2C read then
  fails and touch silently does nothing (demo-shadcn shipped that way while
  demo-st worked on identical hardware). `generateOverlay` now reports the
  missing pins through a diagnostics array and the toolchain prints the
  warning during compile.

## 1.0.0-alpha.12

### Patch Changes

- `discoverFromPath()` now spawns `which west` without a shell on POSIX
  (shell is kept only for Windows' `where`), matching the pattern the rest of
  the discovery code already uses. The unconditional `shell: true` with an
  args array made every Zephyr compile print Node's `DEP0190`
  DeprecationWarning on Linux/macOS.
- Fixed three Zephyr build failures affecting display demos (demo-st) and
  projects rebuilt after the emit naming changed (main.cpp → src.cpp):
  - The generated display overlay node now sets the `pixel-format` property
    (`<0>` = RGB565, matching upstream ILI9341 boards) — required by the
    `lcd-controller` binding in Zephyr 4.x, which previously failed devicetree
    validation with "'pixel-format' is marked as required".
  - `CONFIG_ILI9341=n` is now emitted alongside the existing
    `CONFIG_MIPI_DBI_SPI`/`CONFIG_ST7796S` disables. The in-tree ILI9341
    driver auto-defaults on from the overlay node and references the disabled
    mipi-dbi-spi controller's device struct, failing at link time with
    "undefined reference to `__device_dts_ord_N`". (The hidden `ILI9XXX`
    symbol cannot be assigned — the prompted `ILI9341` is the right lever.)
  - The generated CMakeLists.txt glob now uses `CONFIGURE_DEPENDS`, so CMake
    re-checks the source set when it changes instead of linking a file list
    from the last configure.
- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.12

## 1.0.0-alpha.11

### Minor Changes

- 46f25f2: ## framework-zephyr parity with framework-arduino

  Closes the genuine feature gaps where the (newer) Zephyr framework lagged the
  Arduino framework. The two areas Arduino led — a `licenses` subcommand and the
  `dac`/`fs`/`hwtimer` HAL categories — are now closed.

  ### `cuttlefish licenses` for Zephyr (was missing entirely)

  - **Shared SPDX core** (`@typecad/cuttlefish/api/shared`): extracts the
    framework-agnostic license-detection engine — the SPDX table, marker/alias
    matching (`identifySpdx`), copyleft classification (`classifyRisk`), and the
    LICENSE-file / source-header / manifest resolver (`resolveLibraryLicense`) —
    out of `framework-arduino/src/licenses.ts` into a reusable
    `spdx-licenses.ts`. Arduino is refactored to consume it (its public API and
    tests are unchanged — a non-regressing import-only change).
  - **Zephyr presenter** (`framework-zephyr/src/licenses.ts`): enumerates the
    Zephyr kernel (`$ZEPHYR_BASE`) + the west manifest projects (`west list`)
    and resolves each one's license through the shared core, rendering a
    copyleft-sorted table that mirrors the Arduino presenter. `--strict` exits
    non-zero on any strong-copyleft / unknown dependency; a missing west install
    degrades gracefully instead of crashing. Declared `licenses: { available:
true }` in the Zephyr manifest and exported as the dispatcher-facing
    `licenses` alias. - **Build-based project scope** — unlike Arduino's installed-library
    registry, a Zephyr workspace's west manifest carries _every_ vendor HAL and
    library (most unused by any single project). The default scope therefore
    reports only the dependencies the firmware actually links, derived from the
    last `cuttlefish build`'s `compile_commands.json` (a module is listed iff
    one of its sources was compiled — e.g. an xiao_ble/nRF52840 build links
    `hal_nordic` + the kernel, not the other ~60 modules). Without a build,
    only the kernel is shown with a hint to build first; `--all` lists every
    west module. Module LICENSE files are sought under `zephyr/` and `src/`
    subdirs too (e.g. `hal_nordic` ships `zephyr/LICENSE.txt` → BSD-3-Clause). - The CLI accepts `cuttlefish license` (singular) as an alias, and the shared
    resolver now matches lowercase/`.rst` LICENSE files (e.g.
    trusted-firmware-m's `license.rst`) using their real on-disk name so it
    works on case-sensitive filesystems.

  ### HAL coverage: `dac`, `fs`, `hwtimer` lowerings

  These were previously declared unsupported (the Zephyr manifest flagged `dac`/
  `fs` as "not yet wired"); they now lower to native Zephyr APIs, with
  `profileDiagnostics` gates that surface clear errors for misuse on targets
  lacking the peripheral (mirroring the existing ADC/WiFi gating).

  - **`dac`** — Zephyr DAC driver (`dac_channel_setup` + `dac_write_value`)
    driven by a new chip-descriptor `dac` field. ESP32 declares its two 8-bit
    channels (GPIO25/26); nRF52840 / ESP32-S3 (no DAC) lower to a comment and
    trip `zephyr-dac-pin-unavailable`.
  - **`fs`** — Zephyr FS API (littlefs on the storage partition). A lazy-mount
    shim (formats on first use) backs `begin`/`read_text`/`write_text`/
    `exists`/`remove`; the scaffold emits `CONFIG_FILE_SYSTEM` +
    `CONFIG_FILE_SYSTEM_LITTLEFS`, and the overlay enables the DAC node / points
    at the storage partition.
  - **`hwtimer`** — Zephyr counter driver: `set_frequency` → top value
    (`counter_freq/hz`) + `on_overflow` callback, `start` arms both, `stop`
    halts. A new `hwtimer.controllers` descriptor field maps the instance index
    to a counter nodelabel (nRF RTC1; RTC0 is kernel-owned). The JS
    `setInterval`/`setTimeout` `k_timer` polyfill is unaffected.

  ### Coverage the manifest validator confirms

  The manifest declares `dac`/`fs`/`hwtimer` `supported` and the validator probes
  each op against the resolver — all now lower. The new categories join the
  `halResolutionTests` snapshot suite (`dac.test.ts` rewritten; `fs.test.ts`,
  `hwtimer.test.ts` added) and the shared SPDX core has its own focused test.

  ### No-STL string/array polyfills (compile gap)

  Zephyr is a no-STL target (`hasVector`/`hasString = false`), like AVR — but it
  was missing the two polyfills AVR ships, so programs using string methods or
  dynamic arrays emitted undefined symbols and failed to compile. Two fixes:

  - **Polyfill definitions** — `generateNativePolyfills` now emits a STL-free
    `static_array` (`__tc_StaticArray<T,N>`, mutated/struct array literals + array
    methods) and `string_methods` (`__tc_toUpperCase`/`__tc_endsWith`/… `const
char*` helpers, inline ASCII case conversion so only `<cstring>` is needed).
    Both are declared in `nativePolyfills()` and the manifest's `polyfills.emitted`.
  - **String-method rewrite** — `normalizeRawExpression` now calls
    `applyStringMethodRewrites` (Arduino always did; Zephyr omitted it), so
    `s.toUpperCase()` lowers to `__tc_toUpperCase(s)` and `s.includes(x)` to
    inline `strstr(...)` instead of a member call on `const char*`.

  Verified end-to-end: a program using `s.toUpperCase()` / `s.includes()` /
  `let a = [...]; a.push(...)` now transpiles + compiles for `xiao_ble` (the
  emitted `__tc_StaticArray<double,3>` + `__tc_toUpperCase(s)` resolve). Covered by
  `tests/packages/framework-zephyr/polyfills.test.ts`.

  ### Monochrome OLED display (SSD1306) + direct-display fix

  Closes the display-driver coverage gap (Arduino ships `ssd1309`; Zephyr now
  ships `ssd1306-zephyr`), skipping e-ink. Two coupled changes:

  - **Direct-display bug fix** — `gfx.ts` (the `display_*` runtime for direct
    `display.*` HAL ops, no `@typecad/ui`) was dead code: `shimLines` gated it on
    `!providesDisplayAdapter()`, which is always `true`, so it was never emitted —
    leaving _every_ direct-display program (ili9341/st7796 included) with five
    undefined symbols. The gate now uses the per-program UI signal
    (`usesDisplay && !entryHasUI()`), so the runtime is emitted only when no UI
    adapter (which defines the same `display_init`) will be.
  - **Mono GFX runtime** — `buildDisplayRuntime` now branches on
    `profile.colorFormat`: RGB565 keeps the one-row line buffer; **mono** uses a
    full page-framebuffer (the standard model for page-buffered OLEDs; the
    AGENTS.md "no full framebuffer" guardrail targets RGB SPI TFTs, not OLEDs)
    with Zephyr MONO01 packing (horizontal, MSB-first). `display_fill_rect`/
    `draw_rect`/`draw_text` set bits (`color != 0 ⇒ lit`); `display_flush` pushes
    the whole buffer via `display_write`.
  - **Profile + adapter guard** — new `ssd1306-zephyr` profile (128×64 mono); the
    RGB565/SPI UI adapter declines mono drivers (mono is direct-`display.*` only —
    full `@typecad/ui` CuttlefishGFX rendering on mono OLED is out of scope).

  Caveat: there is no OLED fixture/demo in the repo, so mono rendering is
  validated at the C++-string level (snapshot tests in `display/gfx.test.ts`,
  same bar as the existing `gfx.ts`); the MONO01 bit orientation is isolated to
  `__tc_set_pixel` for a trivial hardware-reveal fix. Manifest + 422-test
  framework-zephyr suite pass.

  ### Intentional differences (unchanged)

  The optional strategy-method differences (`mapPeripheralIdentifier`,
  `isrUnsafeOperations`, `setupInitCode`, library resolution, profile/cli-metadata
  probing) remain deliberate platform divergences — Zephyr resolves pins through
  chip descriptors, uses `printk` over a DT-chosen console (no `Serial.begin`),
  and has no Arduino-library registry. `snprintf` stays unsupported by design
  (raw escape hatch).

- 21b8bbb: ## Zephyr doctor parity with framework-arduino

  Brings `cuttlefish doctor` (Zephyr) to feature parity with the Arduino
  framework's doctor, which checks the build tool is installed and the board
  support is present. The Zephyr doctor now performs the same two checks through
  a new shared, structured `checkZephyrEnv()`:

  - **west toolchain probe** — verifies `west` (the Zephyr build tool) is
    discoverable + responsive (the direct analog of `arduino-cli` presence) and
    reports the discovered version + source. Previously the doctor only read the
    Zephyr RTOS `VERSION` file and never confirmed the actual build tool worked.
  - **board-support check** — verifies the configured board target exists in the
    Zephyr checkout (`$ZEPHYR_BASE/boards/`), the analog of the Arduino
    `arduino-cli core list` check, and prints a `west boards` hint when it is
    missing. Previously the doctor only previewed how the target string
    normalizes.
  - **`checkZephyrEnv()`** — a structured result (`{ ok, reason, messages,
fixCommand, check }`) mirroring `@typecad/arduino-cli`'s `checkArduinoEnv`,
    with failure precedence `west-not-found` → `zephyr-out-of-range` →
    `board-not-supported`. `doctor.ts` is now a thin presenter over it so the
    detection logic can be reused by the build/test gates. The existing
    compat-range check and board-target normalization preview are preserved.

- 85082ed: ## Activation-free builds: discover the @typecad/zephyr-installer micromamba env

  `cuttlefish build` no longer requires `micromamba activate zephyr` first. The
  west discovery cascade gains a new strategy that finds the micromamba env created
  by `@typecad/zephyr-installer` (via `$MAMBA_ROOT_PREFIX/envs/<name>` or
  `~/micromamba/envs/zephyr`), and `westSpawn` invokes west through
  `micromamba run -n <env> west …`. That sets up the env's full PATH
  (cmake/ninja/dtc) AND runs the activation hook (`ZEPHYR_BASE` /
  `ZEPHYR_SDK_INSTALL_DIR`), so a fresh `cuttlefish build` works in any project —
  new or existing — with the user never activating.

  Cascade order is now: PATH → `$ZEPHYR_BASE` → **micromamba env** → well-known
  venvs → system python. The installer env is the managed default when nothing is
  activated; an activated env (PATH) or explicit `$ZEPHYR_BASE` still takes
  precedence. Discovery is file-check based (no spawn) so it adds no per-build
  latency. Env name defaults to `zephyr` (`TYPECAD_ZEPHYR_ENV` override).

  This composes with the per-project auto-activation template
  (`packages/zephyr-installer/templates/project/`) for the user's interactive
  shell: builds need no activation; the shell can still be wired via the template
  for `west`/`gdb`/serial use.

### Patch Changes

- Updated dependencies [46f25f2]
  - @typecad/cuttlefish@1.0.0-alpha.11

## 1.0.0-alpha.10

### Minor Changes

- 9a18c23: ## Zephyr environment doctor + version compat / board-target normalization

  - **`cuttlefish doctor` (Zephyr)** — verify the installed Zephyr RTOS is
    reachable and inside the framework's declared compat range, and preview how the
    configured board target resolves for that version. Exits 0 if the environment
    is OK, non-zero with a clear message otherwise. Mirrors framework-arduino's
    doctor shape (dispatched via the framework's `doctor` export).
  - **`checkZephyrCompat()`** — compare the installed Zephyr version against
    `manifest.compat.zephyr` so an incompatible Zephyr fails fast with a clear
    message instead of a cryptic west/CMake board error.
  - **`resolveBoardTarget()`** — normalize the board target for the installed
    Zephyr version. Zephyr 4.3+ rejects bare multi-core board names
    (`esp32s3_devkitc`) and requires a qualified target
    (`esp32s3_devkitc/esp32s3/procpu`); this rewrites stale configs at build time
    so users don't have to regenerate them after a Zephyr upgrade.

### Patch Changes

- Updated dependencies [c7ea1b5]
  - @typecad/cuttlefish@1.0.0-alpha.10

## 1.0.0-alpha.9

### Patch Changes

- Updated dependencies [a27476a]
  - @typecad/cuttlefish@1.0.0-alpha.9

## 1.0.0-alpha.8

### Patch Changes

- ## Cross-platform Zephyr toolchain installer

  New **`@typecad/zephyr-installer`** package: a one-command, cross-platform
  (Linux / macOS / Windows-native) installer for a working Zephyr build
  environment on micromamba + the official Zephyr SDK. No preinstalled
  conda/Python/toolchain required.

  `node packages/zephyr-installer/install.mjs` dispatches to `install.sh` (POSIX)
  or `install.ps1` (Windows) and: downloads micromamba, creates a `zephyr` conda
  env (host tools from conda-forge; `dtc`/`openocd` on POSIX and `7zip` on Windows
  installed as platform-specific extras, since micromamba ignores `environment.yml`
  line selectors), fetches + SHA256-verifies the Zephyr SDK full bundle (located
  outside the env prefix, idempotent, no `setup.sh`/`sudo` — relies on
  `ZEPHYR_SDK_INSTALL_DIR`), and runs `west init --mr <rev>` + `west update` for a
  vanilla Zephyr workspace.

  Activation hooks export `ZEPHYR_BASE` + `ZEPHYR_SDK_INSTALL_DIR`, so once
  activated, `framework-zephyr`'s west discovery (Strategy 1 — `west` on PATH)
  finds the new install with zero code changes. A `templates/project/` ships
  machine-agnostic activators (`.typecad/activate-zephyr.{ps1,sh}`) plus a VS Code
  terminal profile that auto-activates on terminal open.

  Windows hardening (verified on PowerShell 5.1): downloads via `curl.exe` (not
  `Invoke-WebRequest`, which fails to resolve `api.anaconda.org` through the
  system proxy stack), explicit Windows `tar.exe` (MSYS `tar` mis-parses `C:\`
  paths), fail-fast `$LASTEXITCODE` checks on every native-exe call (no false
  "done" cascades), partial-env-prefix detection with an actionable error, and
  `micromamba shell init` so activation works in new shells without manual
  hook-loading.

  `@typecad/framework-zephyr` (patch): the actionable "west not found" error in
  `west-spawn.ts` now points users at the installer (`node packages/zephyr-installer/install.mjs`).

  Tests: 21 across dispatcher, dry-run, versions, and templates.

  - @typecad/cuttlefish@1.0.0-alpha.8

## 1.0.0-alpha.7

### Minor Changes

- Initial Zephyr RTOS framework package. Lowers HAL operation IR to native
  Zephyr driver API calls, targeting the Seeed Studio XIAO nRF52840
  (`xiao_ble`) via `west` / CMake / Ninja.

  ### HAL lowering (native Zephyr drivers)

  - **GPIO** via devicetree specs (`gpio_pin_*_dt`) — polarity honored by DT
    flags, with a raw-controller fallback for pins without a DT spec. Pull-up /
    pull-down modes (`INPUT_PULLUP`/`INPUT_PULLDOWN`) emit `GPIO_PULL_UP` /
    `GPIO_PULL_DOWN`.
  - **Timing** via `k_msleep` / `k_uptime_get_32` / `k_busy_wait` /
    `k_cycle_get_32`. Timer ops (`set_interval` etc.) unsupported (no async
    runtime yet).
  - **PWM** via `pwm_dt_spec` (`pwm_set_pulse_dt`).
  - **ADC** via nRF SAADC (`adc_read` + per-channel `adc_channel_setup`).
  - **I2C / SPI / UART** via the Zephyr transactional + poll APIs.
  - **Interrupts** via `gpio_init_callback` + `gpio_add_callback` (button on
    the `sw0` DT alias).
  - **WDT / power / tone / pulse / shift** lowered.
  - **BLE** peripheral via the Zephyr `bt_*` GATT API (runtime service
    registration, NimBLE).

  ### Toolchain

  - `west` / CMake build with a 4-strategy discovery cascade (PATH →
    `$ZEPHYR_BASE` venv → well-known workspaces → system python). Idempotent
    `CMakeLists.txt` / `prj.conf` scaffolding.
  - `west flash` (nrfjprog) + `west serial` monitor.

  ### Debug

  - `--debug` routes through `printk` (not `std::cout`, which the minimal libc
    lacks). Console-input halt with per-breakpoint skip/disable.

  ### Honest unsupported surface

  - wifi (nRF52840 has no WiFi), http, display, dac (no DAC on nRF52840),
    board — declared `unsupported` in the manifest with reasons.

  ### Testing

  - Manifest validator (zero-error coverage check).
  - On-device hardware test groups: basics, timing, gpio, analog, timers.
