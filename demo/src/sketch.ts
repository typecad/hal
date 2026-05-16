// ---------------------------------------------------------------------------
// TypeHAL HAL Feature Demo (Arduino Uno)
//
// Demonstrates key HAL abstractions: serial output, LED control,
// digital input with pull-up, button edge detection, and buzzer PWM output.
// Uses cooperative polling pattern compatible with Arduino's loop().
// ---------------------------------------------------------------------------

import { PD2, D4, D9, LED, UART0, millis, PB5 } from '@typehal';

// ── Hardware Setup ─────────────────────────────────────────────────────────
// Serial debug output
const port = UART0.begin(115200);

// Push button (active low with INPUT_PULLUP)
const button = D4.asInputPullUp();

// Outputs
const led = LED.asOutput(false);          // D13 = onboard LED
const buzzer = D9.asOutput(false);       // D9 has PWM capability

// ── State machine state ───────────────────────────────────────────────────

let blinkPhase = 0;
let lastBlinkTime = 0;
let buzzerPhase = 0;
let lastBuzzerTime = 0;
let buttonState = 0;
let edgeTime = 0;
let edgeTimeout = 0;
let unused_variable;

// ── Entry point ───────────────────────────────────────────────────────────
function myIsr(): void {
  // Rapid toggle in ISR to show it's triggered
  // led.toggle();
}

port.println("=== TypeHAL Arduino Uno Demo ===");
port.println("Board: Arduino Uno (ATmega328P)");
port.println("Features: LED blink, button input, buzzer tone, D2 interrupt");

// Attach interrupt to D2 (standard interrupt pin on Uno)
PD2.asInputPullUp().onFalling(myIsr);

setInterval(() => (PB5.toggle()), 500);

// let button = PB5.asInput();
// button.waitForRising();