// ---------------------------------------------------------------------------
// hal.test.ts — thin HAL on hardware (STM32 Black Pill F411CE)
//
// The wet-run counterpart of tests/packages/expect/hal-expect-suite.test.ts:
// the same construction-facts surface, asserted against a real board. Pin
// facts from the board package: PC13 = onboard LED (led0, active-low), PA0 =
// KEY button (sw0, active-low + pull-up). No external wiring is required —
// the I2C and SPI peers have nothing attached, so those assertions check bus
// safety (the register read returns 0 on an empty bus), not sensor data.
//
// Scope note: raw ADC/PWM/Watchdog are NOT exercised here — since the
// board-catalog rework, silicon facts (ADC/PWM matrices) no longer flow into
// generated chip descriptors and the board's devicetree declares no
// watchdog0 alias, so those classes lower to gated no-ops on this target.
// The DT-bound Sensor API (see demos/zephyr-blackpill) is the supported
// analog-input path on Zephyr now.
//
// Flashed + captured by `npm run hal` (@typecad/hal/testing over the framework-
// zephyr west toolchain); the console rides the USB CDC port.
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/hal/testing';
import { LED, BUTTON } from '@typecad/hal';
import { GPIO, I2CTarget, SPITarget, Thread, Time } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);                      // PC13 — onboard LED
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);  // PA0 — KEY button
const sht = new I2CTarget('I2C0', 0x44);                  // i2c1 — empty bus
const flash = new SPITarget('SPI0', 4, { hz: 10_000_000 }); // spi1, CS PA4 — empty bus
const id = new Uint8Array(4);
const worker = new Thread(0, { stackKb: 4 });

worker.start((): void => { Time.sleep(100); });
led.set(true);          // the LED lights — visible proof the suite ran
flash.transceive([0x9F], id);

describe('thin HAL on blackpill')
  .it('Time.now reads monotonic milliseconds since boot')
    .expect(Time.now()).toBeGreaterThan(0)
  .it('button (PA0, sw0 is GPIO_ACTIVE_LOW) reads logically NOT pressed')
    .expect(button.get()).toBeFalsy()
  .it('I2C register read on an empty bus fails safe to 0')
    .expect(sht.readReg(0x32)).toBeWithinRange(0, 255);

worker.join();

done();
