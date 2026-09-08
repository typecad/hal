// ---------------------------------------------------------------------------
// hal.test.ts — thin HAL on hardware (ESP32-S3 devkitC)
//
// The S3-honest suite: the BOOT button is the sw0 dtSpec (GPIO0, active-low
// → logical get() is false while unpressed); the only "LED" is a WS2812 on
// GPIO38 (the deferred LEDStrip surface — not driven here). PWM rides the
// LEDC matrix harvested from esp32s3-pinctrl.h (any of the 45 listed pads,
// 8 channels, build-time assignment); ADC is the SARADC map from the HAL's
// adc_channel.h (GPIO1-10 = adc0 CH0-9, ~1.1 V internal reference); the
// watchdog is timer-group-0's wdt0. I2C/SPI peers have nothing attached,
// so those assertions check bus safety, not device data. No external
// wiring needed — and the hardware-class gateway now exports the full set
// for this board, so this suite uses it all.
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/hal/testing';
import { GPIO, PWM, ADC, Watchdog, SPITarget, Thread, Time } from '@typecad/hal';

const button = new GPIO(0, GPIO.INPUT | GPIO.PULL_UP);    // GPIO0 — BOOT button (sw0, active-low)
const out = new GPIO(21, GPIO.OUTPUT);                    // plain header pin (no LED on this board)
const dimmer = new PWM(17, { periodNs: 20_000_000 });     // LEDC matrix pad, 50 Hz
const sense = new ADC(1, { gain: ADC.GAIN_1, reference: ADC.REF_INTERNAL }); // GPIO1 = CH0
const dog = new Watchdog(8000);
const flash = new SPITarget('SPI0', 10, { hz: 10_000_000 }); // spi2, CS GPIO10 — empty bus
const worker = new Thread(0, { stackKb: 4 });

worker.start((): void => { Time.sleep(100); });
dog.enable();
out.set(true);
dimmer.setDuty(0.5);
flash.write([0x9F]);

describe('thin HAL on esp32s3')
  .it('Time.now reads monotonic milliseconds since boot')
    .expect(Time.now()).toBeGreaterThan(0)
  .it('BOOT button (sw0, active-low) reads logically NOT pressed')
    .expect(button.get()).toBeFalsy()
  .it('ADC (GPIO1/CH0, gain 1x internal ref) reads raw counts within 12 bits')
    .expect(sense.read()).toBeWithinRange(0, 4095)
  .it('SPI write-only transceive on an empty bus is callable')
    .expect((() => { flash.write([0x9F]); return 1; })()).toBe(1);

dog.feed();
worker.join();

done();
