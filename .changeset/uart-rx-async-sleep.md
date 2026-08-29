---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

The async/interrupt tier lands for the thin HAL — the two deliberately-absent surfaces ship:

- **UART RX is interrupt-backed** (`hal/uart-port.ts`): the first receive call arms the driver's IRQ callback (`uart_irq_callback_user_data_set` + `uart_irq_rx_enable`, guarded), and the ISR drains the FIFO into a construction-sized ring — `rxBufferBytes` (default 64) sizes the shim's static buffer, with free-running head/tail counters and drop-on-full (the embedded-honest answer — no unbounded buffering). On that ring, the calls the poll driver honestly could not support now exist: `available()` (bytes waiting), `peek()` (oldest byte without consuming), `read()` (pop, −1 when empty). TX stays poll-based (`uart_poll_out` — synchronous, right for writes). New ops `uart.rx_arm`/`rx_available`/`rx_peek`/`rx_read` (the placeholder `uart.poll_read` is removed); state emission is keyed on the rx ops actually used, so an unused ISR never trips `-Wunused-function`.
- **`await Time.sleep(ms)` is cooperative**: `Time.sleep` now returns `Promise<void>` — bare calls still lower to the blocking `k_msleep` statement, and inside an `async function` the awaited form rides the SAME state-machine machinery `await delay()` uses (`AWAITABLE_HAL_OPS` + a pure-deadline `netWaitInfo` entry: the coroutine arms `_waitUntil` and yields while timers and other tasks run).

Correction to an earlier misdiagnosis: construction facts (e.g. `rxBufferBytes`) resolve correctly EVERYWHERE — top level, plain function bodies, and coroutine bodies (while-conditions + awaited statements). A first observation of default-valued rings inside coroutines was actually the `_rxEcho`/`_rxBufferBytes` field-name mismatch in the same change window, not an async-machinery limitation; a dedicated regression test now pins the coroutine shape (ring at the construction size inside `while (gps.available() < 1) { await Time.sleep(50); }`).

Also: the esp32s3 chip descriptor now declares its user buses (`uart1` with the binding-required pinctrl + current-speed, `i2c0`, `spi2`/`spi3`), mirroring @typecad/board-esp32s3's verified facts — the registry fallback previously had none, so UART/bus e2e tests could not run against the default esp32s3 test target. The ring e2e now runs on that chip. Docs updated (`docs/hal/thin-hal.md`): both entries moved out of "deliberately not here" into their sections with the honest semantics.
