// ---------------------------------------------------------------------------
// main.ts — Arduino Nano 33 IoT (SAMD21G18A) board demo
//
// Breathing onboard LED (PA17 via the board-shipped pwm-led0 alias) with
// USB CDC reports on the micro-USB connector.
//
// What this exercises per peripheral (the thin HAL):
//   PWMLED → PWM driven through the board-shipped pwm-led0 DT alias
//            (PA17, TCC2/WO1); setDuty is a 0.0–1.0 fraction
//   USB0   → CDC-ACM over the micro-USB connector (zephyr_udc0 →
//            cdc_acm_uart0, composed by the overlay generator)
//
// Pipeline: cuttlefish build → out/src/main.cpp → west build → west flash.
// ---------------------------------------------------------------------------

import { PWMLED, USB0 } from '@typecad/board';
import { Time } from '@typecad/hal';

// The onboard LED rides the board-shipped pwm-led0 alias (PA17, TCC2/WO1):
// PWMLED comes pre-constructed from the board module — setDuty drives it
// through that DT alias.

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
    PWMLED.setDuty(breath / 255);                // → PWM_DT_SPEC_GET(DT_ALIAS(pwm_led0))
  } else {
    // Steady half-brightness in normal mode.
    PWMLED.setDuty(0.5);
  }

  // Periodic USB CDC report (~1 Hz): the current mode.
  // Gated on connected() — a CDC port no host has opened swallows output.
  report = report + 1;
  if (report >= 50) {
    report = 0;
    if (USB0.ready()) {
      USB0.writeLine(breathing ? 'mode: breathing' : 'mode: dimmer');
    }
  }

  Time.sleep(20);
}
