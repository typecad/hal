---
'@typecad/cuttlefish': patch
---

Systemic fix for the "dead keypress" bug class: HAL methods whose bodies emit leading side-effect ops before a value-returning op no longer lose them in expression positions.

- **The mechanism**: `tryResolveHALExpression` (if-conditions, comparisons, any pure-expression call site) historically kept only the LAST HAL op of a method body — "preceding ones are side effects" — and discarded the rest. A sweep found the whole vulnerable class: legacy `I2CDevice.readByte`/`readBytes` (the entire Wire transaction prefix — begin/write/end/request — vanished, leaving a bare read of a stale buffer), legacy `SPIDevice.transfer`/`readRegister` (chip-select never toggled), and the thin GPIO methods (configure dropped before reads — the blackpill keypress bug fixed separately via the fused `gpio.read_cfg` op).
- **The fix**: the hal-expr IR now carries `prefixOps`, the resolver populates them instead of dropping them, and the expression renderer wraps the whole sequence in a GCC statement-expression — `({ op1; op2; …; value; })` — the same construct the fused lowerings use, applied generically. Single-op value methods are unchanged (no wrapper).
- **Verified shapes**: `if (dev.readByte(0x32) > 10)` now carries the full transaction (`i2c_write` before `i2c_read` inside the statement-expression); the thin `gpio.read_cfg` fusion and UART RX fusions are unaffected (already single ops).
- **Honest boundary**: legacy `SPIDevice.readRegister`/`transfer` in pure expressions gain their op prefixes but retain a PRE-EXISTING buffer-count arg gap in that context (`CUTTLEFISH_UNDEFINED`) — those methods remain statement-context-supported, as they always were; the frozen surface's arg plumbing is not being extended. Pinned by a test that asserts the prefix mechanics engage without endorsing the legacy expression shape.
- Tests: `tests/packages/cuttlefish/hal-expression-prefix.test.ts` (transaction survival, CS mechanics, single-op no-wrapper).
