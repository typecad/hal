---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

Tier-2 thin buses — Zephyr verbs on every bus, construction facts riding self-contained ops (the Sensor/Time/tier-1 discipline):

- **`I2CTarget`** (`new I2CTarget(I2C0, 0x44, { hz?: 400_000 })`): the Wire transaction dance is replaced by Zephyr's register verbs — `writeReg`/`readReg` → `i2c_reg_write_byte`/`i2c_reg_read_byte`, `updateReg(reg, mask, value)` → the native read-modify-write `i2c_reg_update_byte` (atomic on the wire, no read-back race — `register.ts`-style helpers fold into this), `write(bytes)` → `i2c_write`. The optional `hz` applies once via a guarded `i2c_configure` (Zephyr's `I2C_SPEED_SET` tier mapping).
- **`SPITarget`** (`new SPITarget(SPI0, PA4, { hz: 10_000_000, mode: 0 })`): construction emits a devicetree child node through the same machinery sensors ride — cs-gpios entry (merged after display/sensor CS with stable reg indexes), `spi-max-frequency`, `spi-cpol`/`spi-cpha` — and the verbs lower to `spi_transceive_dt`/`spi_write_dt` against a static `spi_dt_spec`. **Hardware CS** — the legacy path's manual GPIO toggling and runtime `spi_config` rebuilding are gone. `transceive(tx, rx?)` fills the caller's own buffer (omit `rx` for write-only). The nodelabel discipline is shared (`tc_spit_spi<N>_cs<cs>` derived identically in the lowering, the shim state block, and the new `tc-spit-cfg` overlay-scanner comment — the `tc-sensor-cfg` channel).
- **`UART`** (`new UART(UART1, { baud: 9600 })`): the poll API, honestly — `write`/`println` → per-byte `uart_poll_out` with the construction baud applied once (guarded `uart_configure`); `read()` → `uart_poll_in`, non-blocking, returning -1 when empty (Zephyr's own semantics). `available()`/`peek()` are deliberately absent: the byte-level poll driver cannot honor them, and the thin surface doesn't promise what the backend can't deliver.

New ops: `i2c.reg_write`/`reg_read`/`reg_update`/`dev_write`, `spi.transceive`/`dev_write`, `uart.poll_write`/`poll_read` — declared supported in framework-zephyr, unsupported in the frozen framework-arduino manifest. Usage analysis accounts the new ops into the controller-instance sets (shim state gating), and `spiTargetsUsed` drives the per-target `spi_dt_spec` blocks.
