// ---------------------------------------------------------------------------
// hal.test.ts — thin HAL on hardware (Arduino Nano 33 IoT, SAMD21)
//
// The SAMD21-honest subset of the suite (the blackpill run covers the rest):
// SAMD21 has NO watchdog devicetree node (watchdog ops are flagged, not
// lowered), and the board's only PWM channel shares its pin with the LED —
// so PB6-style dimming and the visible LED can't both be had; this run picks
// the LED (the blackpill covers PWM). Raw ADC is NOT exercised — since
// the board-catalog rework, silicon facts (ADC matrices) no longer flow into
// generated chip descriptors, so the class lowers to a gated no-op on this
// target (same scope note as the blackpill run). Pin facts from the board
// package: PA17 = user LED (led0, ACTIVE-HIGH — logical set(true) is plain
// ON), sercom4 = I2C (empty bus), sercom1 = SPI (empty bus, CS PA16),
// sercom5 = UART (an idle line reads -1, Zephyr's poll semantics). If the
// board's console node claims this sercom on your tree, point the UART group
// elsewhere in test-pins.json. The pull-up input is A2 (PA11) —
// a genuine header pin; PA3/AREF is not brought to a header and reads low
// against the weak pull-up. No external wiring is required.
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/hal/testing';
import { GPIO, I2CTarget, SPITarget, UART, Thread, Time } from '@typecad/hal';

const led = new GPIO(17, GPIO.OUTPUT);                    // PA17 — user LED (active-high)
const pin = new GPIO(11, GPIO.INPUT | GPIO.PULL_UP);      // PA11 — A2 header pin (raw path)
const sht = new I2CTarget('I2C0', 0x44);                  // sercom4 — empty bus
const flash = new SPITarget('SPI0', 16, { hz: 4_000_000 }); // sercom1, CS PA16 — empty bus
const gps = new UART('UART0', { baud: 9600 });            // sercom5 — freed by usb console
const id = new Uint8Array(4);
const worker = new Thread(0, { stackKb: 4 });

worker.start((): void => { Time.sleep(100); });
led.set(true);           // the orange LED lights — visible proof the suite ran
flash.transceive([0x9F], id);
gps.write('AT\r\n');

describe('thin HAL on nano33iot')
  .it('Time.now reads monotonic milliseconds since boot')
    .expect(Time.now()).toBeGreaterThan(0)
  .it('pull-up input (A2/PA11, raw path) reads physically high')
    .expect(pin.get()).toBeTruthy()
  .it('I2C register read on an empty bus fails safe to 0')
    .expect(sht.readReg(0x32)).toBeWithinRange(0, 255)
  .it('UART poll read on an idle line returns -1 (Zephyr poll semantics)')
    .expect(gps.read()).toBe(-1);

worker.join();

done();
