---
'@typecad/hal': patch
'@typecad/cuttlefish': patch
'@typecad/framework-zephyr': patch
---

GPIO.get() bug fix — the blackpill demo's keypress was dead: `if (button.get())` never configured the pin.

- **Root cause**: `GPIO.get()`'s method body emits a `gpio.configure` side-effect op *before* the value-returning `gpio.read` op. In pure expression positions (if-conditions, comparisons), the transpiler's expression resolver keeps only the **last** HAL op of a method body — the leading configure was silently dropped, so PA0 (the KEY button) was never set to `GPIO_INPUT | GPIO_PULL_UP`. With no configure call, the DTS node's own `GPIO_PULL_UP` dt-flag never applied either (dt flags ride the configure), and the WeAct KEY circuit has no external pull-up — the pin floated and the button read noise. Statement contexts (the expect preprocessor hoists calls into `const` declarations) emitted both ops, which is why the hardware HAL test passed while the demo failed.
- **Fix**: `get()` now lowers through a single fused op — `gpio.read_cfg { pin, flags }` → one statement-expression `({ <guarded configure> gpio_pin_get_dt/get_raw(...); })` — the same fusion pattern the UART RX ops use, correct in every expression context by construction. New op wired through the IR, resolver, usage accounting, both manifest declarations, and both lowering paths (dtSpec + raw).
- **Regression test** pins the exact failing shape (`if (button.get())` on the sw0 dtSpec asserts the configure-with-pull-up text inside the fused expression).
- The fixed zephyr-blackpill demo was re-flashed and verified on hardware: `if (({ static bool __tc_gpio_cfg_sw0_done = false; … gpio_pin_configure_dt(&__tc_dt_sw0, GPIO_INPUT | GPIO_PULL_UP); … gpio_pin_get_dt(&__tc_dt_sw0); }))`.
- Recorded for the ledger: the expression-path op-dropping (`tryResolveHALExpression` — "preceding ones are side effects") is **generic transpiler behavior**, not GPIO-specific — any HAL method combining leading side-effect ops with a value return needs the fusion pattern (or a hoisted statement) in expression contexts. GPIO.get and the UART RX ops now fuse; future value-returning thin methods should follow.
