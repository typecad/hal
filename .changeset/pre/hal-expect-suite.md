---
'@typecad/hal': patch
'@typecad/cuttlefish': patch
---

HAL expect-based testing suite + blackpill dry run, and a real bug it caught:

- **`tests/packages/expect/hal-expect-suite.test.ts`** — a dry-run harness for the thin HAL through the `@typecad/expect` pipeline: a real user test file (the fluent `describe/it/expect` syntax exercising `Time`, `GPIO`, `PWM`, `ADCChannel`, `Watchdog`, `I2CTarget`, `SPITarget`, and `Thread` together) is preprocessed with the Zephyr output shim (`__tc_print`/`k_msleep`), transpiled through the Zephyr strategy, and asserted on both halves — the serial protocol (`[TC:SUITE_START]`/`[TC:DESCRIBE:*]`/`[TC:EXPECT:*]`/`[TC:SUITE_END]` markers) and every thin lowering (`k_uptime_get`, the guarded `gpio_pin_configure_dt`, `pwm_set_pulse_dt`, the lazy ADC channel setup, `wdt_install_timeout`, `i2c_reg_read_byte`, `spi_transceive_dt`, `K_THREAD_STACK_DEFINE` + `k_thread_create`).
- **Blackpill dry run** — the same program transpiled with the chip descriptor derived from `board-blackpill-f411ce`'s flattened constants via the production `resolveChipFromBoard` path (no registry): the assertions check the board's own facts — `led0` on PC13, `sw0` on PA0, the `pwm4` alias on PB6, ADC1 channel 0, the `iwdg` watchdog node, `i2c1`/`spi1`. The test harness (`tests/setup.ts`) gained an optional `boardConstants` injection on `TranspileOptions` to exercise board-derived chip resolution without the CLI config.
- **Bug fixed**: constructing a thin class without its opts object (`new ADCChannel(pin)`) leaked unresolved `this->_gain` field text into the ops, tripping the ADC token validation. The singleton `__default_fields` channel does not reach constructed instances, so the constructor wiring now seeds explicit per-class field defaults (`_gain`/`_reference` = descriptor-default sentinels, `_hz`, `_baud`, `_mode`, `_resolution`) that fill only absent fields.
