# Framework Coverage

Auto-generated from per-package `framework.manifest.ts` files.
Do not edit directly; run `npm run render:framework-coverage` to regenerate.

Counts are out of 18 HAL categories (raw passthrough tracked separately).

| Framework | HAL cats supported | HAL cats partial | HAL cats unsupported | Toolchain | Last validated |
|---|---|---|---|---|---|
| framework-arduino (canonical) | 12/18 | 4 | 2 | arduino-cli (prepare ✓ compile ✓ upload ✓ monitor ✓) | 2026-07-30 |
| framework-avr | 13/18 | 3 | 2 | arduino-cli (reexported from @typecad/framework-arduino) (prepare ✓ compile ✓ upload ✓ monitor ✓) | 2026-07-30 |
| framework-esp32 | 15/18 | 3 | 0 | idf.py (prepare ✓ compile ✓ upload ✓ monitor ✓) | 2026-07-30 |
| framework-zephyr | 6/18 | 7 | 5 | west (prepare ✓ compile ✓ upload ✓ monitor ✓) | 2026-07-30 |

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
| wifi | unsupported | Arduino core has no WiFi HAL. ESP32 WiFi lives in framework-esp32. |
| http | unsupported | Arduino core has no HTTP client HAL. ESP32 HTTP lives in framework-esp32. |
| display | partial | — |

## framework-avr

**AVR (bare-metal)** — Bare-metal AVR framework. Native register access via ArduinoStrategy overrides.

**Implements:** extends-canonical (based on @typecad/framework-arduino)
**Entrypoint:** `setup` + `loop`
**Toolchain:** arduino-cli (reexported from @typecad/framework-arduino) (prepare ✓ compile ✓ upload ✓ monitor ✓)

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
| wifi | unsupported | AVR has no native WiFi hardware. |
| http | unsupported | AVR has no native HTTP client. |
| display | supported | — |

## framework-esp32

**ESP32 (ESP-IDF)** — Native ESP32 framework targeting ESP-IDF (no Arduino core).

**Implements:** extends-canonical (based on @typecad/framework-arduino)
**Entrypoint:** `setup` + `loop` wrapped in `app_main` bridge
**Toolchain:** idf.py (prepare ✓ compile ✓ upload ✓ monitor ✓)

### HAL categories

| Category | Status | Notes |
|---|---|---|
| gpio | supported | — |
| pwm | supported | — |
| adc | partial | — |
| dac | supported | — |
| interrupts | supported | — |
| tone | supported | — |
| timing | partial | — |
| power | supported | — |
| i2c | partial | — |
| spi | supported | — |
| uart | supported | — |
| pulse | supported | — |
| shift | supported | — |
| board | supported | — |
| wdt | supported | — |
| wifi | supported | — |
| http | supported | — |
| display | supported | — |

## framework-zephyr

**Zephyr RTOS** — Native Zephyr framework targeting the Zephyr RTOS via west/CMake. GPIO is lowered through devicetree specs (gpio_pin_*_dt).

**Implements:** from-scratch
**Entrypoint:** `setup` + `loop` wrapped in `main` bridge
**Toolchain:** west (prepare ✓ compile ✓ upload ✓ monitor ✓)

### HAL categories

| Category | Status | Notes |
|---|---|---|
| gpio | supported | — |
| pwm | supported | — |
| adc | supported | — |
| dac | unsupported | No DAC on nRF52840; lowering not applicable for the MVP target. |
| interrupts | partial | — |
| tone | partial | — |
| timing | partial | — |
| power | partial | — |
| i2c | supported | — |
| spi | partial | — |
| uart | partial | — |
| pulse | partial | — |
| shift | supported | — |
| board | unsupported | Board-specific lowering deferred. |
| wdt | supported | — |
| wifi | unsupported | nRF52840 has no WiFi; not applicable for this target. |
| http | unsupported | HTTP lowering deferred (requires networking stack). |
| display | unsupported | Display lowering deferred. |

## Cross-framework gaps

| Capability | framework-arduino | framework-avr | framework-esp32 | framework-zephyr |
| --- | --- | --- | --- | --- |
| gpio | ✓ | ✓ | ✓ | ✓ |
| pwm | ✓ | ✓ | ✓ | ✓ |
| adc | ✓ | ✓ | ◐ partial | ✓ |
| dac | ✓ | ✓ | ✓ | ✗ (no dac on nrf52840) |
| interrupts | ✓ | ✓ | ✓ | ◐ partial |
| tone | ✓ | ✓ | ✓ | ◐ partial |
| timing | ◐ partial | ◐ partial | ◐ partial | ◐ partial |
| power | ✓ | ✓ | ✓ | ◐ partial |
| i2c | ◐ partial | ◐ partial | ◐ partial | ✓ |
| spi | ✓ | ✓ | ✓ | ◐ partial |
| uart | ◐ partial | ◐ partial | ✓ | ◐ partial |
| pulse | ✓ | ✓ | ✓ | ◐ partial |
| shift | ✓ | ✓ | ✓ | ✓ |
| board | ✓ | ✓ | ✓ | ✗ (board-specific lowering deferred) |
| wdt | ✓ | ✓ | ✓ | ✓ |
| wifi | ✗ (arduino core has no wifi hal) | ✗ (avr has no native wifi hardware) | ✓ | ✗ (nrf52840 has no wifi) |
| http | ✗ (arduino core has no http client hal) | ✗ (avr has no native http client) | ✓ | ✗ (http lowering deferred (requires networking stack)) |
| display | ◐ partial | ✓ | ✓ | ✗ (display lowering deferred) |
