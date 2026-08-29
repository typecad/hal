// ---------------------------------------------------------------------------
// main.ts — Arduino Nano 33 IoT (SAMD21G18A) peripheral showcase
//
// An analog LED dimmer: reads a voltage on A0 (PA2 / ADC AIN0) and maps it
// onto the onboard LED's brightness (PA17 — the board's one PWM channel,
// TCC2/WO1 via the `pwm-led0` DT alias). Every ~2 s the demo alternates
// between "dimmer" and "breathing" modes (the board has no user button),
// and reports the mode + sense voltage over USB CDC on the micro-USB
// connector.
//
// Top-level statements run ONCE at boot (they lower into main()) — the
// program's main loop is the explicit `while (true)`, matching the shape
// `cuttlefish create` scaffolds.
//
// What this exercises per peripheral (the thin HAL):
//   LED / PA17 → PWM with the period as a construction fact — the SAME pin
//                the led0 dtSpec names, driven through the board-shipped
//                pwm-led0 alias; setDuty is a 0.0–1.0 fraction
//   A0 / PA2   → ADCChannel — ADC AIN0 with the sam0 channel setup
//                (ADC_GAIN_1 + ADC_REF_VDD_2, vref = VDDANA/2 = 1650 mV —
//                the only combination Zephyr's sam0 ADC driver accepts on
//                this SoC, so reads saturate above ~1650 mV: keep the input
//                ≤ 1.65 V, e.g. a potentiometer across the middle of the
//                wiper range); readMillivolts applies adc_raw_to_millivolts
//   USB0       → CDC-ACM over the micro-USB connector (zephyr_udc0 →
//                cdc_acm_uart0, composed by the overlay generator)
//
// Pipeline: cuttlefish build → out/src/main.cpp → west build → west flash.
// ---------------------------------------------------------------------------

import { LED, A0, USB0 } from '@typecad/board';
import { PWM, ADCChannel, Time } from '@typecad/hal';

// PA17 doubles as the LED (led0 dtSpec) and the PWM channel (pwm-led0):
// the PWM class drives it through the board-shipped alias with a 20 ms
// construction period (the DT spec's own).
const led = new PWM(LED, { periodNs: 20_000_000 });
const sense = new ADCChannel(A0);             // PA2 — ADC AIN0 analog input

let breathing: boolean = false;
let breath: number = 0;
let breathUp: boolean = true;
let modeTimer: number = 0;

// USB CDC serial over the micro-USB connector. With console.output: 'usb'
// the Zephyr console rides the same port; USB0 gives the program its own
// channel (a second CDC instance if you compose one).
USB0.open();
let report: number = 0;

while (true) {
  // Alternate dimmer ↔ breathing every ~2 s (no user button on this board).
  modeTimer = modeTimer + 1;
  if (modeTimer >= 100) {
    modeTimer = 0;
    breathing = !breathing;
    breath = 0;
  }

  if (breathing) {
    // Triangle wave 0–255 → LED breathing (fraction duty).
    breath = breath + (breathUp ? 5 : -5);
    if (breath >= 250 || breath <= 0) breathUp = !breathUp;
    led.setDuty(breath / 255);                // → PWM_DT_SPEC_GET(DT_ALIAS(pwm_led0))
  } else {
    // Mirror the A0 voltage (0–1650 mV usable range) onto the 0.0–1.0 duty.
    // readMillivolts is hoisted to a statement: nested inside expressions
    // the inline lowering can't resolve the ADC receiver's pin.
    const mv: number = sense.readMillivolts();
    const duty: number = mv / 1650;
    led.setDuty(duty > 1 ? 1 : duty);
  }

  // Periodic USB CDC report (~1 Hz): mode + the current sense voltage.
  // Gated on connected() — a CDC port no host has opened swallows output.
  report = report + 1;
  if (report >= 50) {
    report = 0;
    const mv: number = sense.readMillivolts();
    if (USB0.ready()) {
      USB0.writeLine(breathing ? 'mode: breathing' : 'mode: dimmer');
      USB0.writeLine(`sense: ${mv} mV (full scale 1650)`);
    }
  }

  Time.sleep(20);
}
