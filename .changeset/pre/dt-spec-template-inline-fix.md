---
"@typecad/cuttlefish": patch
"@typecad/framework-zephyr": patch
---

fix: a value-returning HAL call interpolated into another HAL call's template literal (`USB0.writeLine(\`led: ${led.get()}\`)`) is lowered to C++ text while the IR is built — it never becomes a structured hal-op IR node, so every shim decision keyed on walking the program IR missed it. The Zephyr strategy then skipped the state the baked text references and west failed with `'__tc_dt_led0' was not declared in this scope` (zephyr-blackpill demo); the same blind spot left the UART RX ring + ISR, per-controller I2C device handles, per-target `spi_dt_spec`s, per-sensor device handles, ADC channels/override devices, PWM overrides, threads, and interrupt pins undeclared for inlined calls.

- **cuttlefish** — HAL ops resolved to text during a file's IR build are now recorded on that file's `ProgramIR.resolvedHalOps` (a per-build sink in `markHalOpResolved`, lifted at the end of `buildProgramIR`), so per-file scans can see inlined ops without touching module-global state.
- **framework-zephyr** — every per-peripheral scan (bus indices, sensors, SPI targets, UART rings, threads, ADC/PWM pins and overrides, GPIO dt-spec pins, interrupt pins) folds `resolvedHalOps` into the same walk it runs over the IR tree; the dt-spec raw-text scanner sweeps every string leaf of the IR (not just `raw` nodes), where the pre-lowered `__EMIT__` text actually lives; and the async-runtime token scan checks all string payloads too.
