import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles gpioOut, gpioIn
// WIRED TIER — same jumper as 01-loopback (gpioOut → gpioIn). Where that
// file proves the LEVEL path (write high, read high), this one proves the
// EDGE path: a falling edge generated on the output pin fires the handler
// attached on the input pin. Registration-only coverage lives in
// board/01-gpio; this is the firing.
//
// WIRING: one jumper from the board's gpioOut test pin to its gpioIn test
// pin (names in the project's test-pins.json).
//
// The wiring rides MODULE scope (demo style) — construction, attach, and
// the edge write at top level; each .expect() IIFE only polls the flag.
// This mirrors how every demo drives ISR-shared state and keeps the
// lowering shapes the engine is known to handle.
import { GPIO_OUT, GPIO_IN } from '@typecad/test-pins';
import { GPIO, Time } from '@typecad/hal';

// Set from interrupt context (volatile by the ISR-shared analysis).
let fired = 0;

const driveOut = new GPIO(GPIO_OUT, GPIO.OUTPUT);
const senseIn = new GPIO(GPIO_IN, GPIO.INPUT | GPIO.PULL_UP);

// Start HIGH so the falling edge is generated, not inherited.
driveOut.set(true);

senseIn.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  fired = 1;
});

describe("Wired GPIO falling-edge interrupt")
  .it("a high→low transition on the output fires the input's FALLING handler")
  .expect(
    (() => {
      driveOut.set(false);
      // Bounded wait for the ISR to land (it is prompt, but the scheduler
      // may be mid-tick).
      let saw = 0;
      for (let i = 0; i < 100; i += 1) {
        if (fired === 1) {
          saw = 1;
          break;
        }
        Time.sleep(1);
      }
      return saw;
    })
  ).toBe(1)

describe("offInterrupt() stops further edges")
  .it("after detach, a full low→high→low pulse fires nothing")
  .expect(
    (() => {
      senseIn.offInterrupt();
      fired = 0;
      driveOut.set(true);
      Time.sleep(1);
      driveOut.set(false);
      Time.sleep(5);
      // No fire within the wait window after detach.
      return fired === 0 ? 1 : 0;
    })
  ).toBe(1)

done();
