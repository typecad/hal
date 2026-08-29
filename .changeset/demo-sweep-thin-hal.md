---
'@typecad/framework-zephyr': patch
---

Demo sweep — every Zephyr-targeted demo now runs on the thin HAL (legacy timing/GPIO/PWM/ADC classes gone from the converted set; Arduino demos stay frozen by design):

- **`zephyr-blackpill`** — the showcase dimmer: `GPIO` construction flags on led0/sw0, `ADCChannel(A1).readMillivolts()`, `PWM(PB6, { periodNs })` with `setDuty` fractions (the 0–255 `pwm()` duty and its `/13`, `/7` scale arithmetic are gone), `Time.sleep` throughout. Sensors, USB0, and the `I2C0/SPI0.device()` constructions are unchanged (their sanctioned uses).
- **`zephyr-nano-33-iot`** — the LED *is* the PWM channel: `new PWM(LED, { periodNs: 20_000_000 })` replaces the `asOutput` + `pwm()` pair on the shared PA17.
- **`demo-timing`** — rebuilt from the unbuildable aspirational sketch onto the shipped Time API and given a package.json/config/tsconfig so it actually runs: clocks (`Time.now`/`nowUs`), `busyWaitUs`, `setInterval`, and a `Thread` blinking the LED off-main, joined at the end. The emitted output was verified to contain every intended lowering (`K_THREAD_STACK_DEFINE`, `k_thread_create`, `k_msleep(250)` in the thread body, `__tc_setInterval`, `k_uptime_get`, `k_cyc_to_us_floor64`, `k_busy_wait(10)`).
- **`zephyr-debug`**, **`demo`** (BLE), **`demo-contract-board`**, plus `zephyr-blink`'s `multi.ts`/`ble.ts` side files — mechanical `delay → Time.sleep`, `asOutput/asInput → GPIO`, `readAnalog → ADCChannel.read` conversions. README code blocks updated to match.
- Drive-by fix: `zephyr-debug`'s config carried the pre-rename display profile id `st7796-spi` → `st7796-zephyr`; the demo had been un-buildable before this.

All converted demos verified with `cuttlefish build` (transpile-clean).
