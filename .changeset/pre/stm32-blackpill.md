---
'@typecad/framework-zephyr': minor
'@typecad/cuttlefish': minor
---

## STM32 support: the WeAct Black Pill V2.0 (`blackpill_f411ce/stm32f411xe`)

The first STM32 Zephyr target. `@typecad/mcu-stm32f411` defines the
F411CEU6 silicon (34 bonded pins in port-block numbering — PA<bit> → bit,
PB<bit> → 16+bit, PC<bit> → 32+bit — 3× I2C / 3× SPI / 3× USART, ADC1, five
timers), and `@typecad/board-blackpill-f411ce` ships the board chip data
verified against Zephyr 4.3's `blackpill_f411ce` devicetree: per-port
gpioa/gpiob/gpioc controllers, `led0` (PC13) and `sw0` (PA0) DT specs,
i2c1/spi1/usart1, the `iwdg` watchdog node, TIM4 PWM channels, and the
ADC1_IN0–IN9 channel map. `cuttlefish create --target blackpill-f411ce`
scaffolds it; flashing works over ST-Link (`openocd`) or the built-in USB
DFU bootloader.

framework-zephyr gains the lowering machinery STM32 needs:

- **Synthesized PWM specs.** Boards that enable a PWM controller without a
  DT alias (the STM32 pattern) get one generated: the overlay synthesizes a
  `pwm-leds` consumer + `tc-pwm<pin>` alias, and the lowering addresses the
  channel as `PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm<pin>))`.
- **SoC-aware ADC channel setup.** The descriptor carries `gain`/`reference`
  (the STM32 driver requires `ADC_GAIN_1` + `ADC_REF_INTERNAL` with
  vref = VDDA; nRF keeps its SAADC scheme), and per-channel `pinctrl` labels
  let the overlay mux exactly the read channels' pads to analog.
