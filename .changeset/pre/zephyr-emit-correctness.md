---
'@typecad/framework-zephyr': patch
'@typecad/cuttlefish': patch
---

## Emit correctness: port-relative raw GPIO, macro-safe aliases, per-use gating

Four bugs found by building and flashing real hardware, plus a dead-code
rule the emitter now enforces:

- **Raw GPIO uses port-relative indices.** `gpio_pin_*_raw()` addresses the
  index within the controller, not the global pin number. Every raw emission
  site (gpio/pulse/spi lowerings, plus a new `__tc_gpio_pin()` runtime
  dispatcher for the pin-watch and safety shims) now emits `pin - minPin`.
  On the XIAO the old form only worked by an nRF absolute-numbering accident
  and tripped the generic layer's `port_pin_mask` assert on assert-enabled
  builds — the descriptor now declares its real gpio0/gpio1 split.
- **`DT_ALIAS` tokens are macro-safe.** Dashes in DT alias names become
  underscores in Zephyr's generated macros; `DT_ALIAS(pwm-led0)` is a
  subtraction expression and failed to compile. Emitted as `pwm_led0`.
- **The toolchain resolves chips from the board package.** The compile-time
  overlay regen used the hardcoded registry and silently fell back to the
  XIAO descriptor for board-package chips (emitting `&uart0` on an STM32
  whose node is `usart1`). The transpile now persists
  `board-constants.json` next to the emitted source and the toolchain
  resolves through the same path the strategy uses.
- **A-pin aliases resolve through the board's analog list.** `A1` fell
  through to the Arduino `A0 = 14` convention and became a random GPIO on
  every non-Arduino board; it now resolves `pins.analog[n]` → port name →
  pin number.
- **Nothing unused is emitted.** ADC channel setups and PWM specs are gated
  on the pins the program actually touches (deep program-IR walk at emit
  time, source scan at overlay time), so the single generated TU compiles
  with zero `-Wunused-function` warnings and the devicetree carries no dead
  channels.
