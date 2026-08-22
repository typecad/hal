// ---------------------------------------------------------------------------
// main.ts — Black Pill (STM32F411CEU6) peripheral showcase
//
// An analog light-dimmer: reads a voltage on PA1 (ADC1_IN1), smooths it, and
// mirrors it onto PB6 (TIM4_CH1 PWM) as a 0–255 duty. The onboard LED (PC13,
// active-low) heartbeats, and the KEY button (PA0) flips between "dimmer"
// and "breathing" PWM modes.
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

import { LED, BUTTON, A1, PB6 } from '@typecad/board';
import { delay } from '@typecad/hal';

const led = LED.asOutput(false);            // PC13 — .high() = LED on (DT polarity)
const button = BUTTON.asInput();            // PA0 (KEY) — dtSpec sw0, polarity from DT
const sense = A1.asInput();                 // PA1 — ADC1_IN1 analog input
const dimmer = PB6.asOutput(false);         // PB6 — TIM4_CH1 via tc-pwm22

let breathing: boolean = false;
let breath: number = 0;
let breathUp: boolean = true;


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
} else {
  // Mirror the PA1 voltage (0–3300 mV) onto the 0–255 duty range.
  const mv: number = sense.readVoltage(); // → adc_raw_to_millivolts(3300, ADC_GAIN_1, 12, …)
  const duty: number = mv / 13;           // 3300 mV ≈ 254 duty
  dimmer.pwm(duty > 255 ? 255 : duty);
}

led.toggle();                             // heartbeat (PC13)
delay(20);

