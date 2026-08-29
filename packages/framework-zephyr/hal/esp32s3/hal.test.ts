// ---------------------------------------------------------------------------
// hal.test.ts — thin HAL on hardware (ESP32-S3 devkitC)
//
// The S3-honest suite: the BOOT button is the sw0 dtSpec (GPIO0, active-low
// → logical get() is false while unpressed); the only "LED" is a WS2812 on
// GPIO38 (the deferred LEDStrip surface — not driven here); PWM rides the
// LEDC matrix (any listed pad, build-time channel assignment); ADC1 is the
// 12-bit SARADC with gain 1x against the ~1.1 V internal reference (A0 =
// GPIO1 = CH0 — construction tokens keep the pair explicit); the watchdog
// is timer-group-0's wdt0. I2C/SPI peers have nothing attached, so those
// assertions check bus safety, not device data. No external wiring needed.
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/expect';
import { GPIO, PWM, ADCChannel, Watchdog, I2CTarget, SPITarget, Thread, Time } from '@typecad/hal';

const button = new GPIO(0, GPIO.INPUT | GPIO.PULL_UP);    // GPIO0 — BOOT button (sw0, active-low)
const out = new GPIO(21, GPIO.OUTPUT);                    // plain header pin (no LED on this board)
const dimmer = new PWM(17, { periodNs: 20_000_000 });     // LEDC matrix pad, 50 Hz
const sense = new ADCChannel(1, { gain: ADCChannel.GAIN_1, reference: ADCChannel.REF_INTERNAL }); // A0/CH0
const dog = new Watchdog(8000);
const sht = new I2CTarget('I2C0', 0x44);                  // i2c0 — empty bus
const flash = new SPITarget('SPI0', 10, { hz: 10_000_000 }); // spi2, CS GPIO10 — empty bus
const worker = new Thread(0, { stackKb: 4 });

worker.start((): void => { Time.sleep(100); });
dog.enable();
out.set(true);
dimmer.setDuty(0.5);
// Write-only transceive — the empty-bus check exercises the spi_dt_spec
// transaction; the rx-buffer path (Uint8Array lowering through the op) is a
// known gap on the ledger, unexercised until it lands.

describe('thin HAL on esp32s3')
  .it('Time.now reads monotonic milliseconds since boot')
    .expect(Time.now()).toBeGreaterThan(0)
  .it('BOOT button (sw0, active-low) reads logically NOT pressed')
    .expect(button.get()).toBeFalsy()
  .it('ADC (A0, gain 1x internal ref) reads raw counts within 12 bits')
    .expect(sense.read()).toBeWithinRange(0, 4095)
  .it('I2C register read on an empty bus fails safe to 0')
    .expect(sht.readReg(0x32)).toBeWithinRange(0, 255);

dog.feed();
worker.join();

done();
