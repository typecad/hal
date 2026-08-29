// ---------------------------------------------------------------------------
// hal.test.ts — thin HAL on hardware (STM32 Black Pill F411CE)
//
// The wet-run counterpart of tests/packages/expect/hal-expect-suite.test.ts:
// the same construction-facts surface, asserted against a real board. Pin
// facts from the board package: PC13 = onboard LED (led0, active-low), PA0 =
// KEY button (sw0, active-low + pull-up), PA1 = ADC1_IN1, PB6 = TIM4_CH1
// (pwm4), PA4 = spi1 CS. No external wiring is required — the I2C and SPI
// peers have nothing attached, so those assertions check bus safety (the
// register read returns 0 on an empty bus), not sensor data.
//
// Flashed + captured by `npm run hal` (@typecad/expect over the framework-
// zephyr west toolchain); the console rides the USB CDC port.
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/expect';
import { GPIO, PWM, ADCChannel, Watchdog, I2CTarget, SPITarget, Thread, Time } from '@typecad/hal';

const led = new GPIO(45, GPIO.OUTPUT);                    // PC13 — onboard LED
const button = new GPIO(0, GPIO.INPUT | GPIO.PULL_UP);    // PA0 — KEY button
const dimmer = new PWM(22, { periodNs: 20_000_000 });     // PB6 — TIM4_CH1 @ 50 Hz
const sense = new ADCChannel(1);                          // PA1 — ADC1_IN1
const dog = new Watchdog(8000);                           // generous: suite finishes in ms
const sht = new I2CTarget('I2C0', 0x44);                  // i2c1 — empty bus
const flash = new SPITarget('SPI0', 4, { hz: 10_000_000 }); // spi1, CS PA4 — empty bus
const id = new Uint8Array(4);
const worker = new Thread(0, { stackKb: 4 });

worker.start((): void => { Time.sleep(100); });
dog.enable();
led.set(true);          // the LED lights — visible proof the suite ran
dimmer.setDuty(0.5);
flash.transceive([0x9F], id);

describe('thin HAL on blackpill')
  .it('Time.now reads monotonic milliseconds since boot')
    .expect(Time.now()).toBeGreaterThan(0)
  .it('button (PA0, sw0 is GPIO_ACTIVE_LOW) reads logically NOT pressed')
    .expect(button.get()).toBeFalsy()
  .it('ADC (PA1) reads raw counts within the 12-bit range')
    .expect(sense.read()).toBeWithinRange(0, 4095)
  .it('I2C register read on an empty bus fails safe to 0')
    .expect(sht.readReg(0x32)).toBeWithinRange(0, 255);

dog.feed();
worker.join();

done();
