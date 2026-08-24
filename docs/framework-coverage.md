# Framework Coverage

Auto-generated from per-package `framework.manifest.ts` files.
Do not edit directly; run `npm run render:framework-coverage` to regenerate.

Counts are out of 19 HAL categories (raw passthrough tracked separately).

| Framework | HAL cats supported | HAL cats partial | HAL cats unsupported | Toolchain | Last validated |
|---|---|---|---|---|---|
| framework-arduino (canonical) | 12/19 | 4 | 3 | arduino-cli (prepare ✓ compile ✓ upload ✓ monitor ✓) | 2026-08-24 |
| framework-zephyr | 11/19 | 8 | 0 | west (prepare ✓ compile ✓ upload ✓ monitor ✓ debug ✓) | 2026-08-24 |

## framework-arduino

**Arduino** — Canonical Arduino framework. Targets AVR, ESP, RP2040, RP2350, SAMD, megaAVR via arduino-cli.

**Implements:** from-scratch
**Entrypoint:** `setup` + `loop`
**Toolchain:** arduino-cli (prepare ✓ compile ✓ upload ✓ monitor ✓)

### HAL categories

| Category | Status | Notes |
|---|---|---|
| gpio | supported | — |
| pwm | supported | — |
| adc | supported | — |
| dac | supported | — |
| interrupts | supported | — |
| tone | supported | — |
| timing | partial | — |
| power | supported | — |
| i2c | partial | — |
| spi | supported | — |
| uart | partial | — |
| pulse | supported | — |
| shift | supported | — |
| board | supported | — |
| wdt | supported | — |
| wifi | unsupported | Arduino core has no WiFi HAL. On ESP32 targets, @typecad/hal lowers WiFi natively via ESP-IDF (esp_wifi), independent of this framework. |
| http | unsupported | Arduino core has no HTTP client HAL. On ESP32 targets, @typecad/hal lowers HTTP over its native WiFi stack, independent of this framework. |
| mqtt | unsupported | No MQTT lowering in the Arduino core (requires networking stack). |
| display | partial | — |

## framework-zephyr

**Zephyr RTOS** — Native Zephyr framework targeting the Zephyr RTOS via west/CMake. GPIO is lowered through devicetree specs (gpio_pin_*_dt).

**Implements:** from-scratch
**Entrypoint:** `main` + no loop
**Toolchain:** west (prepare ✓ compile ✓ upload ✓ monitor ✓ debug ✓)

### HAL categories

| Category | Status | Notes |
|---|---|---|
| gpio | supported | — |
| pwm | supported | — |
| adc | supported | — |
| dac | partial | — |
| interrupts | partial | — |
| tone | partial | — |
| timing | supported | — |
| power | partial | — |
| i2c | supported | — |
| spi | supported | — |
| uart | partial | — |
| pulse | partial | — |
| shift | supported | — |
| board | supported | — |
| wdt | supported | — |
| wifi | partial | AP client enumeration/IP/per-station config, credential persistence, static IP, auto-reconnect, and tx-power have no Zephyr lowering (no driver/Kconfig hook). |
| http | supported | — |
| mqtt | supported | — |
| display | partial | Mono panels (ssd1306) are direct-op only (no UI rendering); ili9341 UI path is ported but not yet hardware-verified; e-ink is out of scope at this time. |

## Cross-framework gaps

| Capability | framework-arduino | framework-zephyr |
| --- | --- | --- |
| gpio | ✓ | ✓ |
| pwm | ✓ | ✓ |
| adc | ✓ | ✓ |
| dac | ✓ | ◐ partial |
| interrupts | ✓ | ◐ partial |
| tone | ✓ | ◐ partial |
| timing | ◐ partial | ✓ |
| power | ✓ | ◐ partial |
| i2c | ◐ partial | ✓ |
| spi | ✓ | ✓ |
| uart | ◐ partial | ◐ partial |
| pulse | ✓ | ◐ partial |
| shift | ✓ | ✓ |
| board | ✓ | ✓ |
| wdt | ✓ | ✓ |
| wifi | ✗ (arduino core has no wifi hal) | ◐ partial |
| http | ✗ (arduino core has no http client hal) | ✓ |
| mqtt | ✗ (no mqtt lowering in the arduino core (requires networking stack)) | ✓ |
| display | ◐ partial | ◐ partial |
