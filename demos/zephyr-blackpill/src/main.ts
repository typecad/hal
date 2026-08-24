// ---------------------------------------------------------------------------
// main.ts — Black Pill (STM32F411CEU6) peripheral showcase
//
// An analog light-dimmer: reads a voltage on PA1 (ADC1_IN1) and mirrors it
// onto PB6 (TIM4_CH1 PWM) as a 0–255 duty. The KEY button (PA0) flips between
// "dimmer" and "breathing" PWM modes, and the onboard LED (PC13, active-low)
// heartbeats at a rate that shows the mode: fast (~100 ms) in dimmer mode,
// slow (~500 ms) in breathing mode.
//
// Top-level statements run ONCE at boot (they lower into setup()) — the
// program's main loop is the explicit `while (true)`, matching the shape
// `cuttlefish create` scaffolds.
//
// What this exercises per peripheral:
//   LED / PC13   → gpio dtSpec (led0) — GPIO_ACTIVE_LOW honored by the DT
//   BUTTON / PA0 → gpio dtSpec (sw0) — active-low + pull-up from the DT
//   PB6          → synthesized PWM spec: the overlay generator creates a
//                  pwm-leds consumer + tc-pwm22 alias for TIM4_CH1
//   PA1          → ADC1_IN1 with the STM32 channel setup (ADC_GAIN_1 +
//                  ADC_REF_INTERNAL, vref = VDDA); the overlay muxes exactly
//                  the read channels' pads to analog via pinctrl
//
// Pipeline: cuttlefish build → out/src/main.cpp → west build → west flash.
// ---------------------------------------------------------------------------

import { LED, BUTTON, A1, PB6, USB0 } from '@typecad/board';
import { delay } from '@typecad/hal';

const led = LED.asOutput(false);            // PC13 — .high() = LED on (DT polarity)
const button = BUTTON.asInput();            // PA0 (KEY) — dtSpec sw0, polarity from DT
const sense = A1.asInput();                 // PA1 — ADC1_IN1 analog input
const dimmer = PB6.asOutput(false);         // PB6 — TIM4_CH1 via tc-pwm22

let breathing: boolean = false;
let breath: number = 0;
let breathUp: boolean = true;
let tick: number = 0;

// USB CDC serial over the USB-C connector (OTG_FS → zephyr_udc0 + a
// cdc_acm_uart0 instance the overlay composes). Independent of the console:
// console.log stays on usart1 (PA9/PA10); USB0.println goes out the connector.
USB0.begin(115200);
let report: number = 0;

while (true) {
  // KEY press toggles dimmer ↔ breathing mode (no interrupt needed for a demo).
  // The sw0 dtSpec path honors GPIO_ACTIVE_LOW, so .read() is the logical
  // state: true while the button is pressed.
  if (button.read()) {
    breathing = !breathing;
    delay(150);                             // crude debounce
  }

  if (breathing) {
    // Triangle wave 0–255 → LED-style breathing on PB6.
    breath = breath + (breathUp ? 5 : -5);
    if (breath >= 250 || breath <= 0) breathUp = !breathUp;
    dimmer.pwm(breath);                     // → pwm_set_pulse_dt(&__tc_pwm_tc_pwm22, ...)
    tick = tick + 1;
    if (tick >= 25) { led.toggle(); tick = 0; }   // slow heartbeat (~500 ms)
  } else {
    // Mirror the PA1 voltage (0–3300 mV) onto the 0–255 duty range.
    const mv: number = sense.readVoltage(); // → adc_raw_to_millivolts(3300, ADC_GAIN_1, 12, …)
    const duty: number = mv / 13;           // 3300 mV ≈ 254 duty
    dimmer.pwm(duty > 255 ? 255 : duty);
    tick = tick + 1;
    if (tick >= 5) { led.toggle(); tick = 0; }    // fast heartbeat (~100 ms)
  }

  // Periodic USB CDC report (~1 Hz): mode + the current sense voltage.
  // Gated on connected() — a CDC port no host has opened swallows output.
  // (readVoltage is hoisted to a statement: nested inside printf args the
  // inline lowering can't resolve the ADC receiver's pin.)
  report = report + 1;
  if (report >= 50) {
    report = 0;
    const mv: number = sense.readVoltage();
    if (USB0.connected()) {
      USB0.println(breathing ? 'mode: breathing' : 'mode: dimmer');
      USB0.printf('sense: %d mV\n', mv);
    }
  }

  delay(20);
}
