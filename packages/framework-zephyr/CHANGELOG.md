# @typecad/framework-zephyr

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
