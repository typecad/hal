// ---------------------------------------------------------------------------
// TypeHAL HAL Feature Demo (Arduino Uno)
//
// Demonstrates key HAL abstractions: serial output, LED control,
// digital input with pull-up, button edge detection, and buzzer PWM output.
// Uses cooperative polling pattern compatible with Arduino's loop().
// ---------------------------------------------------------------------------

import { D4, D9, LED, UART0, millis } from '@typehal';

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

// ── Entry point ───────────────────────────────────────────────────────────

function setup(): void {
  port.println("=== TypeHAL Arduino Uno Demo ===");
  port.println("Board: Arduino Uno (ATmega328P)");
  port.println("Features: LED blink, button input, buzzer tone");
}

function loop(): void {
  const now = millis();

  // ── Blink LED every 500ms ─────────────────────────────────────────────
  if (now - lastBlinkTime >= 500) {
    lastBlinkTime = now;
    if (blinkPhase === 0) {
      led.write(true);
      blinkPhase = 1;
    } else {
      led.write(false);
      blinkPhase = 0;
    }
  }

  // ── Button edge detection ──────────────────────────────────────────────
  const btnLow = !button.read();  // INPUT_PULLUP = active low

  // Wait for press
  if (buttonState === 0 && btnLow) {
    buttonState = 1;
    edgeTime = now;
    port.println("  Button pressed!");
  }

  // Debounce 50ms, then wait for release or timeout
  if (buttonState === 1 && !btnLow && (now - edgeTime >= 50)) {
    buttonState = 0;
    edgeTime = now;
    port.println("  Button released!");

    // Buzzer beep on release
    buzzer.tone(880);
    buzzerPhase = 1;
    lastBuzzerTime = now;
  }

  // ── Buzzer tone duration (300ms) ──────────────────────────────────────
  if (buzzerPhase === 1 && (now - lastBuzzerTime >= 300)) {
    buzzer.noTone();
    buzzerPhase = 0;
  }
}