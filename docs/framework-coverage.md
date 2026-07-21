# Framework Coverage

Auto-generated from per-package `framework.manifest.ts` files.
Do not edit directly; run `npm run render:framework-coverage` to regenerate.

Counts are out of 18 HAL categories (raw passthrough tracked separately).

| Framework | HAL cats supported | HAL cats partial | HAL cats unsupported | Toolchain | Last validated |
|---|---|---|---|---|---|
| framework-arduino (canonical) | 12/18 | 4 | 2 | arduino-cli (prepare ✓ compile ✓ upload ✓ monitor ✓) | 2026-07-21 |
| framework-avr | 12/18 | 3 | 3 | arduino-cli (reexported from @typecad/framework-arduino) (prepare ✓ compile ✓ upload ✓ monitor ✓) | 2026-07-21 |
| framework-esp32 | 14/18 | 3 | 1 | idf.py (prepare ✓ compile ✓ upload ✓ monitor ✓) | 2026-07-21 |

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
| display | unsupported | AVR has no display driver. resolveDisplayOp is inherited from Arduino and lowers display.init — known latent inheritance bug; future spec will override. |

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
| display | unsupported | Deferred to v1.1; ESP-IDF display drivers pending. See packages/framework-esp32/src/lowering/index.ts:46. |

## Cross-framework gaps

| Capability | framework-arduino | framework-avr | framework-esp32 |
| --- | --- | --- | --- |
| gpio | ✓ | ✓ | ✓ |
| pwm | ✓ | ✓ | ✓ |
| adc | ✓ | ✓ | ◐ partial |
| dac | ✓ | ✓ | ✓ |
| interrupts | ✓ | ✓ | ✓ |
| tone | ✓ | ✓ | ✓ |
| timing | ◐ partial | ◐ partial | ◐ partial |
| power | ✓ | ✓ | ✓ |
| i2c | ◐ partial | ◐ partial | ◐ partial |
| spi | ✓ | ✓ | ✓ |
| uart | ◐ partial | ◐ partial | ✓ |
| pulse | ✓ | ✓ | ✓ |
| shift | ✓ | ✓ | ✓ |
| board | ✓ | ✓ | ✓ |
| wdt | ✓ | ✓ | ✓ |
| wifi | ✗ (arduino core has no wifi hal) | ✗ (avr has no native wifi hardware) | ✓ |
| http | ✗ (arduino core has no http client hal) | ✗ (avr has no native http client) | ✓ |
| display | ◐ partial | ✗ (avr has no display driver) | ✗ (deferred to v1) |
