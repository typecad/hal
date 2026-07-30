// ---------------------------------------------------------------------------
// main.ts — @typecad/safety showcase demo
//
// Demonstrates safe.read(Pin): a digitalRead that composes with @typecad/hal's
// Pin class, verifies the pin's recorded mode at runtime (via the auto-
// populated mode table), performs a 2-of-3 vote via the strategy-injected
// __tc_gpio_read shim, and returns a SafeReadResult carrying any detected
// fault.
//
// Two scenarios surface the SafeReadResult surface deterministically (no
// electrical noise required):
//   1. Happy path      — button pin configured as INPUT_PULLUP; safe.read
//                        returns Ok and the value drives the LED.
//   2. PinModeMismatch — pin explicitly configured as OUTPUT, then read;
//                        safe.read returns the Configuration fault.
//
// The two-tier fault taxonomy (category + code) lets user-space route faults
// coarsely by category (survives future safety standards like ISO 26262)
// while still logging the specific code for diagnosis.
//
// Target: AVR (Arduino Uno). The same sketch compiles unchanged on any
// target whose framework strategy contributes the __tc_gpio_read shim
// (AVR/ESP32 inherit from ArduinoStrategy; native provides a stub).
// ---------------------------------------------------------------------------

import { delay } from '@typecad/hal';
import { safe, SafetyFaultCategory, SafetyFaultCode, SafetyStatus } from '@typecad/safety';
import { D4, D11, D12 } from '@typecad/board';


// --- Pin wiring ---------------------------------------------------------
//
// GPIO4: button (input, pulled up — pressed = LOW). The happy-path pin.
// GPIO5: deliberately configured as OUTPUT to demonstrate PinModeMismatch.
// GPIO2: onboard-style LED (output) — reflects the button state.
//
// GPIO numbers on ESP32-S3 are the canonical identity; Pin.fromPort() is the
// idiomatic HAL constructor.
const buttonPin = D4.asInputPullUp();
const ledPin    = D11.asOutput();
const wrongModePin = D12.asOutput();  // OUTPUT — wrong for reading

// Throttle the diagnostic fault logs so they don't spam — log the mismatch
// scenario at most once every ~5 seconds (20 * 250ms loop).
const LOG_THROTTLE_ITERATIONS = 20;
let loggedMismatchAt: number = -LOG_THROTTLE_ITERATIONS;
let iteration: number = 0;

function setup(): void {
  console.log("safety showcase ready");
  console.log("scenarios: button (GPIO4 → LED), wrong-mode (GPIO5 → fault)");
}

function loop(): void {
  // --- Scenario 1: happy path -------------------------------------------
  // buttonPin is INPUT_PULLUP — safe.read verifies the mode (valid for
  // reading), performs a 2-of-3 vote, returns Ok with the debounced value.
  const button = safe.read(buttonPin);
  if (button.status === SafetyStatus.Ok) {
    ledPin.write(button.value);
  } else {
    handleFault("button", button.category, button.code);
  }

  // --- Scenario 2: PinModeMismatch --------------------------------------
  // wrongModePin is configured as OUTPUT — safe.read rejects it with a
  // Configuration/PinModeMismatch fault. Throttled to avoid log spam.
  const wrongMode = safe.read(wrongModePin);
  if (wrongMode.status !== SafetyStatus.Ok && (iteration - loggedMismatchAt) >= LOG_THROTTLE_ITERATIONS) {
    handleFault("wrong-mode", wrongMode.category, wrongMode.code);
    loggedMismatchAt = iteration;
  }

  iteration = iteration + 1;
  delay(250);
}

/** Coarse fault routing by category — survives future safety standards
 *  (ISO 26262, IEC 61508, DO-178C all surface faults under the same 5
 *  categories). The specific code is logged for diagnosis. */
function handleFault(scenario: string, category: SafetyFaultCategory, code: SafetyFaultCode): void {
  switch (category) {
    case SafetyFaultCategory.Configuration:
      // A pin-mode problem (mismatch or unknown). For a real safety-critical
      // system this is where you'd log to NVS, fail safe, or halt.
      console.log(`[${scenario}] configuration fault (code ${code})`);
      break;
    case SafetyFaultCategory.Signal:
      // Vote disagreement — transient noise on the line.
      console.log(`[${scenario}] signal fault (code ${code})`);
      break;
    default:
      console.log(`[${scenario}] unexpected category ${category} (code ${code})`);
      break;
  }
}
