// ---------------------------------------------------------------------------
// Hardware simulation — Button + LED
//
// Runs entirely on your computer with `npm run simulate` (vitest + the
// @typecad/hal/sim subpath). No board, serial port, or arduino-cli required.
// The simulator mirrors the pins/peripherals of your Black Pill (STM32F411)
// (blackpill-f411ce); you inject fake inputs and assert on the outputs in Node.
//
// This is the fast tier — iterate on logic here, then confirm on real hardware
// with `npm run test:hw` (which flashes tests/ to the board).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  createSimBoard,
  type SimBoard,
  type SimDigitalPin,
} from "@typecad/hal/sim";

// ===========================================================================
// FIRMWARE LOGIC
// ---------------------------------------------------------------------------
// Factor your firmware into a function that takes the simulated pins as
// arguments. In a real project this same logic runs on the board against real
// pins — here it runs against the sim board so you can test it without hardware.
// ===========================================================================

/**
 * Reads a button and reflects its state on an LED.
 *
 * To use your own logic: replace the body of this function with whatever your
 * firmware does (read a sensor, drive a motor, print to serial, ...). As long
 * as it only touches pins you pass in, the simulator can exercise it.
 */
function reflectButtonOnLed(button: SimDigitalPin, led: SimDigitalPin): void {
  // The button pin is pulled HIGH (1) at rest and reads LOW (0) when pressed.
  if (button.isLow()) {
    led.high();
  } else {
    led.low();
  }
}

// ===========================================================================
// TEST BENCH
// ---------------------------------------------------------------------------
// `createSimBoard` builds an in-memory version of your board. The pin numbers
// below match the physical pinout. Add the pins/peripherals your firmware uses:
// board.digital(n), board.analog(n), board.pwm(n), board.serial(n),
// board.i2c(n), board.spi(n), board.interrupt(n).
// ===========================================================================

function setupSim(): { board: SimBoard; button: SimDigitalPin; led: SimDigitalPin } {
  const board = createSimBoard({});

  const button = board.digital(2).asInputPullUp();  // button on pin 2 (INPUT_PULLUP)
  const led = board.digital(13).asOutput(false);    // LED on pin 13

  return { board, button, led };
}

describe("Button + LED (simulator)", () => {
  beforeEach(() => {
    // A fresh board per test keeps state isolated. For a long-running sim you
    // can call board.reset() between cycles instead.
  });

  it("keeps the LED off while the button is released", () => {
    const { button, led } = setupSim();

    // Button at rest: INPUT_PULLUP reads HIGH.
    reflectButtonOnLed(button, led);

    expect(led.getBitValue()).toBe(0);
  });

  it("turns the LED on while the button is pressed", () => {
    const { button, led } = setupSim();

    // Simulate a press: drive the button pin LOW.
    button.injectValue(0);
    reflectButtonOnLed(button, led);

    expect(led.getBitValue()).toBe(1);
  });
});
