---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

Time API — the TypeScript-flavored timing surface, first step of the Zephyr-first HAL (Arduino is frozen on the legacy forms):

- **`Time`** (`@typecad/hal`, hal/time.ts): `Time.sleep(ms)` → `k_msleep` (yielding sleep, `delay()`'s replacement), `Time.now()` → `k_uptime_get()` as a double (ms since boot, no uint32 wrap, `Date.now()`-shaped), `Time.nowUs()` → `k_cyc_to_us_floor64(k_cycle_get_64())`, `Time.busyWaitUs(us)` → `k_busy_wait` (spin, no yield — `delayMicroseconds`'s honest name), plus `Time.freeHeap()`.
- **New ops** `timing.sleep` / `timing.now` / `timing.now_us` / `timing.busy_wait_us`, declared supported in framework-zephyr and unsupported in the frozen framework-arduino manifest — the sensor precedent (framework-scoped vocabulary) applied to the first HAL family.
- **Deprecated, still lowering**: `delay`/`millis`/`micros`/`delayMicroseconds`/`freeHeap` module functions and the `Timing` class keep their current lowerings permanently (framework-arduino is frozen, not removed).
- **Dropped**: `map()` / `constrain()` free functions — Arduino-core macro pass-throughs with no Zephyr-native lowering.
