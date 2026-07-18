# @typecad/framework-esp32

TypeCAD framework package that lowers HAL operation IR to **native ESP-IDF driver API calls**. Generates a real ESP-IDF project (`app_main` + `main/main.cc` + `CMakeLists.txt` + `sdkconfig.defaults`), compiled through ESP-IDF's `idf.py`.

## Requirements

- ESP-IDF v5.x installed. Source the environment before running cuttlefish:
  - POSIX: `. $IDF_PATH/export.sh`
  - Windows: `%IDF_PATH%\export.bat`
- Or use the ESP-IDF VS Code extension, which sources the env on terminal open.

The framework detects `$IDF_PATH` and `idf.py` on `$PATH`. If either is missing, it errors with a clear message pointing at the export script.

## How it works

- HAL ops (`gpio.write`, `i2c.begin`, etc.) lower to native IDF driver calls (`gpio_set_level`, `i2c_master_*`, etc.) — no Arduino API.
- The generated `main/main.cc` defines `extern "C" void app_main(void)` — the IDF-canonical entrypoint.
- `app_main` spawns a FreeRTOS task (`__tc_app_task`) that runs the synthesizer-emitted `setup()` once, then loops `loop()`. Stack/priority match the Arduino loopTask defaults (8192, priority 1).
- The framework emits a complete ESP-IDF project: root `CMakeLists.txt`, `main/CMakeLists.txt`, `sdkconfig.defaults`, `.gitignore`.

## Installation

```sh
cuttlefish init   # select "ESP32 (native ESP-IDF)" for an ESP32-family target
```

Or in `cuttlefish.config.ts`:

```ts
export default {
  framework: '@typecad/framework-esp32',
  frameworkData: { target: 'esp32' },  // or esp32s3 / esp32c3 / esp32c6
  toolchain: { type: 'idf' },
};
```

## Supported variants

| Variant | `frameworkData.target` | Architecture |
|---|---|---|
| ESP32 (classic) | `'esp32'` | Xtensa LX6 |
| ESP32-S3 | `'esp32s3'` | Xtensa LX7 |
| ESP32-C3 | `'esp32c3'` | RISC-V |
| ESP32-C6 | `'esp32c6'` | RISC-V |

## HAL coverage (v1)

- **GPIO** → `gpio_set_direction/level/get_level/reset_pin` + `gpio_pullup_en`/`gpio_pulldown_en`
- **PWM** → LEDC (`ledc_timer_config`, `ledc_set_duty`/`ledc_update_duty`); channels allocated lazily per pin
- **ADC** → `adc1_get_raw` + `esp_adc_cal_raw_to_voltage` (ADC1 only in v1; ADC2 conflicts with WiFi)
- **DAC** → `dac_output_voltage` (classic ESP32 + S3 only — `profileDiagnostics` errors on C3/C6)
- **I2C** → v5 master bus API (`i2c_new_master_bus`, `i2c_master_bus_add_device`, `i2c_master_transmit`/`receive`); three-step `beginTransmission`/`write`/`endTransmission` dance preserved as a txbuf buffering pattern
- **SPI** → bus + device handle (`spi_bus_initialize`, `spi_bus_add_device`, `spi_device_polling_transmit`); CS via `gpio_set_level`
- **UART** → `uart_driver_install`/`write_bytes`/`read_bytes`/`get_buffered_data_len`/`wait_tx_done`
- **Timing** → `vTaskDelay` (delay), `esp_rom_delay_us` (delayMicroseconds), `esp_timer_get_time` (millis/micros), `esp_get_free_heap_size`
- **Interrupts** → `gpio_install_isr_service` + `gpio_isr_handler_add`/`remove` (handlers carry `IRAM_ATTR`)
- **Power** → `esp_sleep_enable_timer_wakeup` + `esp_deep_sleep_start`/`esp_light_sleep_start`; `set_cpu_frequency` → `rtc_clk_cpu_freq_set_freq_hz` (pending spike confirmation)
- **WDT** → `esp_task_wdt_init`/`add`/`reset`/`delete`/`deinit` (task watchdog, not RTC watchdog)
- **pulse** → `esp_timer_get_time`-based edge timer (no native IDF equivalent)
- **shift** → GPIO bit-bang (`__tc_shift_in`/`__tc_shift_out`)

## Console

`console.log`/`console.info` → `printf`; `console.debug`/`warn`/`error` → `ESP_LOG[DWI]` with a `"tc"` tag. ESP_LOG* only emit at or below the configured log level (default `INFO`; debug suppressed unless bumped).

## First-build latency

The first `idf.py build` for a target takes 1-3 minutes (generates `sdkconfig`, configures CMake for the chip via `idf.py set-target`). Subsequent builds are fast (~10s incremental). This is inherent to ESP-IDF's chip-specific configuration step.

## Library discovery (v1: manual)

framework-esp32 does not run the ESP-IDF component manager automatically. Add components by editing `main/idf_component.yml`:

```yaml
dependencies:
  espressif/esp_wifi: "^1.0"
  espressif/esp_lcd_ili9341: "^1.0"
```

Then `idf.py reconfigure` fetches them from the ESP Component Registry.

## Limitations (v1)

- Preferences/NVS lowering not yet implemented; use `rawCpp()` + `#include "nvs_flash.h"`.
- WiFi/BLE/mDNS lowering not yet implemented (pending HAL ops).
- Deep-sleep pin wakeup (RTC GPIO) not yet implemented; timer wakeup works.
- ADC calibration uses deprecated `esp_adc_cal_*`; will migrate to `adc_cali_line_fitting_*` in v1.1.
- `tone.play`/`tone.stop` are stubs pending LEDC channel allocation work.
- No `menuconfig` pass-through; edit `sdkconfig.defaults` directly or run `idf.py menuconfig` yourself.
- `idf.py` error parsing into structured `CompileError[]` deferred to v1.1 (v1 dumps raw output).

## Design

See `docs/superpowers/specs/2026-07-18-framework-esp32-design.md` for the full design spec. Architecture: `Esp32Strategy extends ArduinoStrategy` (mirrors `framework-avr`'s pattern), overriding only ESP-IDF-specific emit behavior; the `Toolchain` export replaces the parent's arduino-cli toolchain wholesale.
