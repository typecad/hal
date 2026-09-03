# Framework Coverage

Auto-generated from per-package `framework.manifest.ts` files.
Do not edit directly; run `npm run render:framework-coverage` to regenerate.

Counts are out of 15 HAL categories (raw passthrough tracked separately).

| Framework | HAL cats supported | HAL cats partial | HAL cats unsupported | Toolchain | Last validated |
|---|---|---|---|---|---|
| framework-zephyr | 10/15 | 5 | 0 | west (prepare ✓ compile ✓ upload ✓ monitor ✓ debug ✓) | 2026-09-01 |

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
| timing | supported | — |
| i2c | supported | — |
| spi | supported | — |
| uart | partial | — |
| board | supported | — |
| wdt | supported | — |
| wifi | partial | Per-station AP enumeration and credential persistence have no Zephyr lowering (no driver/Kconfig hook). |
| http | supported | — |
| mqtt | supported | — |
| display | partial | Mono panels (ssd1306) are direct-op only (no UI rendering); ili9341 UI path is ported but not yet hardware-verified; e-ink is out of scope at this time. |

## Cross-framework gaps

| Capability | framework-zephyr |
| --- | --- |
| gpio | ✓ |
| pwm | ✓ |
| adc | ✓ |
| dac | ◐ partial |
| interrupts | ◐ partial |
| timing | ✓ |
| i2c | ✓ |
| spi | ✓ |
| uart | ◐ partial |
| board | ✓ |
| wdt | ✓ |
| wifi | ◐ partial |
| http | ✓ |
| mqtt | ✓ |
| display | ◐ partial |
