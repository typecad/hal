# @typecad/framework-zephyr

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
