---
'@typecad/hal': minor
'@typecad/cuttlefish': major
'@typecad/framework-zephyr': minor
---

Legacy-HAL removal — Family 3: the Arduino-named timing surface and legacy singleton APIs are gone. The kept-surface rule held throughout: every deletion happened only after its replacement existed and demos/tests migrated.

- **Demo sweep first** (the deletion gate): wifi-demo's 11 programs and demo-shadcn swept off `delay()` → `Time.sleep`; two files converted from `D2.asOutput()` to `new GPIO(D2, GPIO.OUTPUT)`. Both demos transpile clean.
- **`hal/timing.ts` deleted**: `TimingClass`, `delay/millis/micros/delayMicroseconds/freeHeap`. The JS-named timers (`setInterval/setTimeout/clearInterval/clearTimeout`) moved to `hal/time.ts` unchanged — they were the one Arduino-era piece that predates Arduino and lowers cleanly everywhere (`__tc_setInterval` k_timer polyfill). Legacy ops `timing.delay/delay_microseconds/millis/micros/free_heap` pruned from KINDS/interfaces/resolver/usage/analysis/async-machine/lowering/manifest; `timing.sleep` remains the sole awaitable deadline op.
- **WDT**: legacy `enable/reset` (WDTO/string parsing) removed; `Watchdog` keeps construction-time `wdt.setup/feed/disable`.
- **HardwareTimer**: instance methods (`setFrequency/onOverflow/start/stop`) removed — `Counter` owns those verbs; the counter init-state emission (shared device handle/hz/callback vars) is retained for Counter.
- **Validator/test fixtures updated**: probe payload tables and timing fixtures no longer reference removed ops; empty `hwtimer` manifest section dropped.
- Suites rewritten to surviving surface: timing (Time.* + interval polyfill), wdt (setup/feed/disable + init state), hwtimer (init block + Counter ownership).

Full battery: 314 files / 3198 tests passing.

Remaining in Phase 2 ledger: ADC/DAC singleton classes (`ADC.read(pin)`/`setAnalogReference`, `DAC.write`) — kept until board-package exports are audited; pin-state-tracking deletion (16 sites; triggers still partially live via thin gpio.set).
