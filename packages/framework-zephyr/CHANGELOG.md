# @typecad/framework-zephyr

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
