import { I2C0, SPI0, UART0, delay } from '@typecode';

// ── I2C with ownership ─────────────────────────────────────────────────────
// take() claims exclusive access; returns undefined if already owned.
// The returned IOwnedI2CBus has the full II2CBus API plus release().

const i2c = I2C0.take();
if (i2c) {
  // Bus is owned — safe to do I/O through the typed device accessor
  i2c.device(0x76).writeByte(0xFA, 0x55);
  i2c.release();  // return bus to shared pool
}