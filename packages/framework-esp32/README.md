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
- `app_main` runs the synthesizer-emitted `setup()` once, then loops `loop()` forever — the IDF-idiomatic pattern (cf. the official `esp_http_client` example, where `app_main` itself blocks on `example_connect()`). `app_main` never returns. Stack is `CONFIG_ESP_MAIN_TASK_STACK_SIZE=16384` (set in sdkconfig.defaults); the IDF default of 3584 overflows on WiFi/HTTP paths.
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

## Watchdog

`app_main` calls `vTaskDelay(1)` after each `loop()` iteration. This yields the CPU to the IDLE task so its watchdog doesn't fire when `loop()` is empty or runs without blocking. **This does not interfere with the user-facing watchdog** (`WDT.enable`/`WDT.reset`):

- **Without `WDT.enable()`** (default): `main_task` is not subscribed to the task watchdog. If `loop()` hangs, nothing happens — same as Arduino's default.
- **With `WDT.enable(timeout)`**: `main_task` is subscribed via `esp_task_wdt_add(NULL)`. The user must call `WDT.reset()` within the timeout, or the watchdog fires and the device reboots. The loop's `vTaskDelay(1)` does NOT call `esp_task_wdt_reset()`, so it does not feed the user's watchdog — if `loop()` hangs, the watchdog still fires correctly.

Separately, the WiFi shim wraps its blocking `WiFi.connect()` / `WiFi.scan()` / `untilConnected()` / `untilDisconnected()` waits with `esp_task_wdt_stop()` / `esp_task_wdt_restart()` (compile-gated on `CONFIG_ESP_TASK_WDT_EN`). `main_task` isn't WDT-subscribed, so `esp_task_wdt_reset()` is a no-op for it — the timer itself has to be paused while the user's code blocks for up to 15 s on a connect, otherwise the prio-23 WiFi task can starve CPU0's IDLE task during radio bring-up and trip the WDT.

```ts
import { WDT, Timing } from '@typecad/hal';

export function setup() {
  WDT.enable(5000);  // 5s timeout
}

export function loop() {
  // ... do work ...
  WDT.reset();  // feed the watchdog. If loop() hangs >5s, device reboots.
}
```

## Console

`console.log`/`console.info` → `printf`; `console.debug`/`warn`/`error` → `ESP_LOG[DWI]` with a `"tc"` tag. ESP_LOG* only emit at or below the configured log level (default `INFO`; debug suppressed unless bumped).

## First-build latency

The first `idf.py build` for a target takes 1-3 minutes (generates `sdkconfig`, configures CMake for the chip via `idf.py set-target`). Subsequent builds are fast (~10s incremental). This is inherent to ESP-IDF's chip-specific configuration step.

## Components (managed + local)

Declare ESP-IDF components in `cuttlefish.config.ts` under `frameworkData.components`:

```ts
const config: CuttlefishConfig = {
  // ...
  frameworkData: {
    target: 'esp32s3',
    components: {
      managed: {
        'espressif/esp_wifi': '^1.0',
        'espressif/esp_mqtt': '^1.0',
      },
      local: [
        './components/my_sensor',   // becomes an EXTRA_COMPONENT_DIRS entry
      ],
    },
  },
};
```

framework-esp32 then:

1. **Scaffolds** `main/idf_component.yml` from `managed` (and emits
   `EXTRA_COMPONENT_DIRS` into the root `CMakeLists.txt` from `local`).
2. **Reconfigures** (`idf.py reconfigure`) when the deps hash changes,
   populating `managed_components/`.
3. **Generates `.d.ts` stubs** for each component's headers, so user code
   can `import` the component APIs.

C components (free functions, typedefs, structs) are emitted as **free
functions whose names match the C header 1-to-1** — `esp_wifi_init` stays
`esp_wifi_init`. This is deliberate: ESP-IDF examples call `esp_wifi_init`,
never `esp_wifi.init`, and the dotted form has no C++ representation (there
is no `esp_wifi` object in the real header). Mirroring the C names verbatim
means the transpiler lowers TS calls directly to valid C with zero
translation. C++ components use the existing class-based emitter. Generated
stubs live inside the gitignored `managed_components/` and are regenerated
on each reconfigure.

Use the stubs from your TypeScript:

```ts
import {
  esp_wifi_init,
  esp_wifi_set_mode,
  WIFI_MODE_STA,
} from '../managed_components/espressif__esp_wifi/include/esp_wifi';
esp_wifi_set_mode(WIFI_MODE_STA);
esp_wifi_init(/* ... */);
```

Standalone regeneration (without a full build):

```bash
cuttlefish gen-decls --components
```

### Limitations

- Headers with heavy macros, function-pointer callbacks, or Kconfig-gated
  types may emit `any` fallbacks with a diagnostic. Use `rawCpp()` for
  anything the generated stub doesn't cover.
- `main/idf_component.yml` is generated from config — hand edits are
  overwritten on the next scaffold. Edit `cuttlefish.config.ts` instead.

## Limitations (v1)

- Preferences/NVS lowering not yet implemented; type-checks but emits no runtime code. Use `rawCpp()` + `#include "nvs_flash.h"`.
- EEPROM lowering not yet implemented; type-checks but emits no runtime code. Use Preferences / NVS instead.
- WiFi/HTTP: first-class HAL ops (native `esp_wifi`/`esp_http_client`), including async/await.
- BLE (NimBLE): first-class HAL ops for GATT peripheral (server/characteristics, read/write/notify callbacks, async connect). Central/client is a follow-on.
- mDNS: no first-class HAL ops; usable via components or `rawCpp()`.
- Deep-sleep pin wakeup (RTC GPIO) not yet implemented; timer wakeup works.
- ADC calibration uses deprecated `esp_adc_cal_*`; will migrate to `adc_cali_line_fitting_*` in v1.1.
- Display/graphics overrides not yet implemented (inherited from ArduinoStrategy; may emit Arduino API calls).
- No `menuconfig` pass-through; edit `sdkconfig.defaults` directly or run `idf.py menuconfig` yourself.

## Design

See `docs/superpowers/specs/2026-07-18-framework-esp32-design.md` for the full design spec. Architecture: `Esp32Strategy extends ArduinoStrategy` (mirrors `framework-avr`'s pattern), overriding only ESP-IDF-specific emit behavior; the `Toolchain` export replaces the parent's arduino-cli toolchain wholesale.
