// ---------------------------------------------------------------------------
// Example 21 — Bus Ownership Pattern (Opt-In)
//
// Demonstrates the opt-in bus ownership pattern for I2C, SPI, and UART buses.
// take() acquires exclusive access and returns an owned bus handle.
// release() returns the bus to the shared pool.
//
// On single-threaded Arduino, take()/release() are no-ops (emitted as comments)
// but the transpiler validates correct usage:
//
//   - Error:   double take without release
//   - Warning: I/O without ownership
//   - Warning: release without take
//
// On multi-threaded platforms (ESP32), take()/release() map to mutex
// acquisition/release for thread-safe peripheral sharing.
//
// Ownership is opt-in: if you never call take(), no diagnostics are generated.
// ---------------------------------------------------------------------------

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

// ── SPI with ownership ─────────────────────────────────────────────────────

const spi = SPI0.take();
if (spi) {
  spi.beginTransaction({ frequency: 1000000, mode: 0, bitOrder: 'msb' });
  spi.endTransaction();
  spi.release();
}

// ── UART with ownership ────────────────────────────────────────────────────

const uart = UART0.take();
if (uart) {
  uart.println("Bus is owned — safe to print");
  uart.flush();
  uart.release();
}

// ── Main loop: re-acquire and release each iteration ───────────────────────
while (true) {
  const bus = I2C0.take();
  if (bus) {
    bus.device(0x76).writeByte(0xFA, 0x55);
    bus.release();
  }

  delay(1000);
}
