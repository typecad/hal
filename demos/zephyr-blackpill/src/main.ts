// ---------------------------------------------------------------------------
// main.ts — Black Pill (STM32F411CEU6) peripheral showcase
//
// An analog light-dimmer: reads a voltage on PA1 (ADC1_IN1) and mirrors it
// onto PB6 (TIM4_CH1 PWM) as a duty fraction. The KEY button (PA0) flips
// between "dimmer" and "breathing" PWM modes, and the onboard LED (PC13,
// active-low) heartbeats at a rate that shows the mode: fast (~100 ms) in
// dimmer mode, slow (~500 ms) in breathing mode.
//
// Top-level statements run ONCE at boot (they lower into main()) — the
// program's main loop is the explicit `while (true)`, matching the shape
// `cuttlefish create` scaffolds.
//
// What this exercises per peripheral (the thin HAL):
//   LED / PC13   → GPIO with construction flags — the led0 dtSpec honors
//                  GPIO_ACTIVE_LOW, so set(true) = LED on
//   BUTTON / PA0 → GPIO.INPUT | GPIO.PULL_UP — sw0 dtSpec, logical get()
//   PB6          → PWM with the period as a construction fact: the overlay
//                  generator creates a pwm-leds consumer + tc-pwm22 alias
//                  for TIM4_CH1; setDuty is a 0.0–1.0 fraction (one
//                  pwm_set_pulse_dt, no 0–255 scaling)
//   PA1          → ADCChannel — ADC1_IN1 with the STM32 channel setup
//                  (ADC_GAIN_1 + ADC_REF_INTERNAL, vref = VDDA); the overlay
//                  muxes exactly the read channels' pads to analog via
//                  pinctrl; readMillivolts applies adc_raw_to_millivolts
//
// Pipeline: cuttlefish build → out/src/main.cpp → west build → west flash.
// ---------------------------------------------------------------------------

import { LED, BUTTON, A1, PB6, USB0, I2C0, SPI0, PA4 } from '@typecad/board';
import { GPIO, PWM, ADCChannel, Time, Sensor, SENSOR, CHAN } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);        // PC13 — set(true) = LED on (DT polarity)
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);  // PA0 (KEY) — sw0 dtSpec, logical get()
const sense = new ADCChannel(A1);              // PA1 — ADC1_IN1 analog input
const dimmer = new PWM(PB6, { periodNs: 20_000_000 });      // PB6 — TIM4_CH1 via tc-pwm22, 50 Hz

let breathing: boolean = false;
let breath: number = 0;
let breathUp: boolean = true;
let tick: number = 0;

// USB CDC serial over the USB-C connector (OTG_FS → zephyr_udc0 + a
// cdc_acm_uart0 instance the overlay composes). Independent of the console:
// console.log stays on usart1 (PA9/PA10); USB0.writeLine goes out the connector.
USB0.open();

// SHT3X temp/humidity breakout on I2C0 (i2c1: PB8 SCL / PB9 SDA) at 0x44.
// The generic catalog path: SENSOR.sensirion_sht3xd is a Zephyr binding
// token — the build generates the DT child node and the in-tree sht3xd
// driver turns itself on from it (Kconfig default y). No devicetree text,
// no Kconfig, no per-part package anywhere.
const sht3x = new Sensor(SENSOR.sensirion_sht3xd, I2C0.device(0x44));
// BME280 on SPI0 (spi1: PA5 SCK / PA6 MISO / PA7 MOSI), CS on PA4 — the SPI
// catalog path: the overlay emits cs-gpios plus a child node whose reg is
// the CS index. Comment out if no BME280 is wired (the boot probe fails
// gracefully; fetch then errors, nothing else breaks).
const bme = new Sensor(SENSOR.bosch_bme280, SPI0.device(PA4), { spiHz: 10000000 });
const s = new Sensor(SENSOR.bosch_bma280, I2C0.device(0x44));

let report: number = 0;
let env: number = 0;

while (true) {
  // KEY press toggles dimmer ↔ breathing mode (no interrupt needed for a demo).
  // The sw0 dtSpec path honors GPIO_ACTIVE_LOW, so get() is the logical
  // state: true while the button is pressed.
  if (button.get()) {
    breathing = !breathing;
    Time.sleep(150);                          // crude debounce
  }

  if (breathing) {
    // Triangle wave 0–255 → LED-style breathing on PB6 (fraction duty).
    breath = breath + (breathUp ? 5 : -5);
    if (breath >= 250 || breath <= 0) breathUp = !breathUp;
    dimmer.setDuty(breath / 255);             // → pwm_set_pulse_dt(&__tc_pwm_tc_pwm22, …)
    tick = tick + 1;
    if (tick >= 25) { led.toggle(); tick = 0; }   // slow heartbeat (~500 ms)
  } else {
    // Mirror the PA1 voltage (0–3300 mV) onto the 0.0–1.0 duty fraction.
    const mv: number = sense.readMillivolts(); // → adc_raw_to_millivolts(3300, ADC_GAIN_1, 12, …)
    const duty: number = mv / 3300;
    dimmer.setDuty(duty > 1 ? 1 : duty);
    tick = tick + 1;
    if (tick >= 5) { led.toggle(); tick = 0; }    // fast heartbeat (~100 ms)
  }

  // Periodic USB CDC report (~1 Hz): mode + the current sense voltage.
  // Gated on connected() — a CDC port no host has opened swallows output.
  // (readMillivolts is hoisted to a statement: nested inside printf args the
  // inline lowering can't resolve the ADC receiver's pin.)
  report = report + 1;
  if (report >= 50) {
    report = 0;
    const mv: number = sense.readMillivolts();
    if (USB0.ready()) {
      USB0.writeLine(breathing ? 'mode: breathing' : 'mode: dimmer');
      USB0.writeLine(`sense: ${mv} mV`);
    }
  }


  // SHT3X report (~5 s): fetch once, then read both channels from the same
  // sample (Zephyr's own fetch/get split — sensor_sample_fetch /
  // sensor_channel_get on the generated device handle).
  env = env + 1;
  if (env >= 250) {
    env = 0;
    sht3x.fetch();
    const temp: number = sht3x.get(CHAN.AMBIENT_TEMP);
    const rh: number = sht3x.get(CHAN.HUMIDITY);
    bme.fetch();
    const pa: number = bme.get(CHAN.PRESS);
    const acc_x = s.get(CHAN.ACCEL_X)
    // Both float paths: %f through cbprintf (the build turns on
    // CONFIG_CBPRINTF_FP_SUPPORT when it sees a float specifier) and
    // Math.round (lowered to std::round under <cmath>).
    const tenths: number = Math.round(temp * 10);
    if (USB0.ready()) {
      USB0.writeLine(`sht3x: ${temp} C  ${rh} %RH  bme: ${pa} hPa (t10=${tenths / 10})`);
    }
  }

  Time.sleep(20);
}
