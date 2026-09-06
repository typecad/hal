---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

Tier-1 thin Zephyr-shaped classes — construction facts + Zephyr verbs, one call per method, no semantic translation. Each class follows the Sensor/Time pattern: hollow classes whose construction arguments ride self-contained ops to the lowering; flag/gain tokens are Zephyr's own names carried as source text and mapped name-for-name onto the C macros, with build-time re-validation that names the valid spellings.

- **`GPIO`** (`new GPIO(PB5, GPIO.OUTPUT | GPIO.OUTPUT_INIT_LOW)`): flag tokens replace mode strings — `INPUT_PULLUP` mapping tables are gone on this path; `OUTPUT_INIT_LOW/HIGH` configure the initial level atomically (no configure-then-write glitch window); `set/get/toggle` reuse the polarity-correct dtSpec/raw lowering; the configure itself is guarded per pin and applied ahead of first use. `onInterrupt(GPIO.INT_EDGE_FALLING, …)` uses INT tokens — covering the `INT_LEVEL_*` modes the legacy `onChange` strings could not express.
- **`PWM`** (`new PWM(PA5, { periodNs: 20_000_000 })`): the period is a construction fact, applied once at first use; `setPulse(ns)` → `pwm_set_pulse_dt` verbatim; `setDuty(0.0–1.0)` is sugar over exactly one `set_pulse` call (no 0–255 scaling anywhere); `setPeriod` exposes `pwm_set_period_dt`, previously hidden. ESP32 LEDC matrix pins resolve through the synthesized `tc-pwm<pin>` alias.
- **`ADCChannel`** (`new ADCChannel(PA0, { gain: ADCChannel.GAIN_1_4, reference: ADCChannel.REF_INTERNAL })`): gain/reference are construction facts (`struct adc_channel_cfg`'s own fields), defaulting to the chip descriptor's pair; `read()` returns raw counts, `readMillivolts()` applies `adc_raw_to_millivolts`. No `setReference()` — Zephyr applies it at channel-setup time, so the surface doesn't promise runtime switching.
- **`DACChannel`** (`new DACChannel(PA4, { resolution: 12 })`): raw `dac_write_value` codes (0–4095 at 12-bit), construction resolution overriding the descriptor default, lazy setup per pin.
- **`Watchdog`** (`new Watchdog(2500)`): timeout-at-construction in ms — `enable()` arms (`wdt_install_timeout` + `wdt_setup`), `feed()` keeps it alive. No WDTO_* presets, no string parsing.
- **`Counter`** (`new Counter(0, { hz: 1000 })`): Zephyr's counter driver with Zephyr's verbs (`onAlarm`/`start`/`stop`), sharing the hwtimer per-instance state; `start()` carries the construction hz so there is no ordering constraint with `onAlarm`.

New ops: `gpio.configure`, `interrupt.attach_flags`, `pwm.set_pulse`/`set_duty`/`set_period`, `adc.read_raw`/`read_mv`, `dac.write_value`, `wdt.setup`/`wdt.feed`, `counter.on_alarm`/`start`/`stop` — declared supported in framework-zephyr and unsupported in the frozen framework-arduino manifest (legacy classes and their lowerings are untouched and permanent).
