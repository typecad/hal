// ---------------------------------------------------------------------------
// universal-peripherals.ts — the multi-peripheral canary program.
//
// Exercises GPIO, UART (poll-out + RX ring), I2C register walk, SPI register
// sugar, the timing API, console output (printk) and the abs/min math shims
// in one program — so a sweep run stresses every universal lowering path per
// board, not just the LED blink.
//
// Board-signal failures, by design: a board whose devicetree has no led0,
// uart0, i2c0 or spi0 node fails at import, lowering or link — the sweep
// then reports which boards can't run each peripheral. Runtime reads target
// unwired addresses on purpose: an empty I2C/SPI bus reads 0 and fails safe,
// so the firmware is observable on real hardware without any wiring.
//
// Type notes (transpiler constraints): template literals interpolate
// integer-valued numbers fine, but doubles (Time.now(), Math.floor) do not —
// clock values are only compared, never printed. All arithmetic stays on
// small integers.
// ---------------------------------------------------------------------------

import { GPIO, I2CTarget, SPITarget, UART, Time, abs, min } from '@typecad/hal';
import { LED } from '@typecad/hal';

// GPIO — the canonical board LED keeps the firmware observable on hardware.
const led = new GPIO(LED, GPIO.OUTPUT);

// UART — poll-out banner + the RX-ring peek. No peer is wired; available()
// stays 0 and read() returns -1, both honest no-op paths.
const serial = new UART('UART0', { baud: 115200 });

// I2C — register walk on bus 0. An unwired address reads 0 and fails safe.
const sensor = new I2CTarget('I2C0', 0x44);

// SPI — register sugar on bus 0, CS on flat pin 4.
const flash = new SPITarget('SPI0', 4, { hz: 1000000 });

const boot: number = Time.now();
serial.println('universal-peripherals up');
console.log('universal-peripherals up');

let ticks: number = 0;

while (true) {
  ticks = ticks + 1;
  led.toggle();

  // UART: per-byte poll_out write, the newline form, and a ring peek.
  serial.write('tick ');
  serial.println('x');
  const rx: number = serial.available();

  // I2C: register read + read-modify-write on an unwired address (reads 0).
  const whoami: number = sensor.readReg(0x0f);
  sensor.updateReg(0x10, 0x0f, ticks % 16);

  // SPI: register read sugar + raw write (BME280 chip-id address; empty bus
  // reads 0).
  const chipId: number = flash.readReg(0xd0);
  flash.write([ticks % 256, 0x42]);

  // Math shims + the monotonic clock (compared, never printed — doubles).
  const delta: number = abs(ticks - 4);
  const window: number = min(delta, 4);
  const up: number = Time.now() - boot;

  console.log(`tick ${ticks} rx=${rx} who=${whoami} id=${chipId} delta=${delta} win=${window} up=${up}ms`);

  Time.sleep(1000);
}
