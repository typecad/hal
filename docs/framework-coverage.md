# Framework Coverage

Auto-generated from per-package `framework.manifest.ts` files.
Do not edit directly; run `npm run render:framework-coverage` to regenerate.

Counts are out of 18 HAL categories (raw passthrough tracked separately).

| Framework | HAL cats supported | HAL cats partial | HAL cats unsupported | Toolchain | Last validated |
|---|---|---|---|---|---|
| framework-arduino (canonical) | 12/18 | 4 | 2 | arduino-cli (prepare ✓ compile ✓ upload ✓ monitor ✓) | 2026-08-03 |
| framework-zephyr | 10/18 | 6 | 2 | west (prepare ✓ compile ✓ upload ✓ monitor ✓) | 2026-08-03 |

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
| dac | unsupported | No DAC lowering implemented in the framework (not applicable on nRF52840; ESP32 variants with DAC not yet wired). |
| interrupts | partial | — |
| tone | partial | — |
| timing | supported | — |
| power | partial | — |
| i2c | supported | — |
| spi | supported | — |
| uart | partial | — |
| pulse | partial | — |
| shift | supported | — |
| board | unsupported | Board-specific lowering deferred. |
| wdt | supported | — |
| wifi | partial | AP mode, credential persistence, static IP, and event callbacks not yet lowered. |
| http | supported | — |
| display | supported | — |

## Cross-framework gaps

| Capability | framework-arduino | framework-zephyr |
| --- | --- | --- |
| gpio | ✓ | ✓ |
| pwm | ✓ | ✓ |
| adc | ✓ | ✓ |
| dac | ✓ | ✗ (no dac lowering implemented in the framework (not applicable on nrf52840) |
| interrupts | ✓ | ◐ partial |
| tone | ✓ | ◐ partial |
| timing | ◐ partial | ✓ |
| power | ✓ | ◐ partial |
| i2c | ◐ partial | ✓ |
| spi | ✓ | ✓ |
| uart | ◐ partial | ◐ partial |
| pulse | ✓ | ◐ partial |
| shift | ✓ | ✓ |
| board | ✓ | ✗ (board-specific lowering deferred) |
| wdt | ✓ | ✓ |
| wifi | ✗ (arduino core has no wifi hal) | ◐ partial |
| http | ✗ (arduino core has no http client hal) | ✓ |
| display | ◐ partial | ✓ |
