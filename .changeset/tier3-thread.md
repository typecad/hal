---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

Tier-3 thin OS surface — `Thread`, the first raw kernel-thread class:

- **`Thread`** (`new Thread(0, { stackKb: 4, priority: 3 })`): construction carries the thread's facts — `stackKb` (default 2) sizes a static `K_THREAD_STACK_DEFINE`, `priority` (default 5, Zephyr's scale: negative = cooperative) rides the create call. `start(fn)` → `k_thread_create(…, K_NO_WAIT)` through a per-slot entry trampoline bridging Zephyr's `(void*, void*, void*)` signature to the registered no-arg closure (the same callback machinery interrupts use); `join()` → `k_thread_join(…, K_FOREVER)`. State emission is keyed on `thread.start` ops — `join()` without a prior `start()` on the index is a build error naming the slot's symbol, documented on the method. No devicetree, no Kconfig; `kernel.h` (always included) is the whole dependency. The JS `setTimeout`/`setInterval` polyfill (k_timer) is unaffected — different surface, different guarantees.
- New ops `thread.start` / `thread.join`, declared supported in framework-zephyr and unsupported in the frozen framework-arduino manifest.

Tier-3 scoping decisions recorded for later: **LEDStrip** is deferred after verifying the pinned Zephyr (4.4) ws2812 bindings — the SPI backend requires per-SoC `spi-one-frame`/`spi-zero-frame` timing symbols (the binding's own docs: "hardware specific tuning is required"), which cannot be derived from construction facts without a per-board verified defaults table. **FS** stays as-is (its surface is already fact-shaped: mount once, path-string verbs over `fs_read`/`fs_write`); **Settings/Power/Random** stay service-shaped per the tier plan.
