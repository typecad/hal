import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles gpioOut, gpioIn
// WIRED TIER — not part of the default per-board runs (the board configs'
// include patterns cover common/ and board/ only). Run explicitly with:
//
//   npm run test:hw:wired --workspace @typecad/hal
//
// WIRING: one jumper from the board's gpioOut test pin to its gpioIn test
// pin (names in the project's test-pins.json). This is where the HAL stops
// being smoke-tested: an output level written through the thin GPIO class on
// real silicon is read back through a real input buffer, proving the full
// configure/set/get path end to end.
import { GPIO_OUT, GPIO_IN } from '@typecad/test-pins';
import { GPIO, Time } from '@typecad/hal';

describe("Wired GPIO output-to-input loopback")
  .it("high written on the output pin reads back on the input pin")
  .expect(
    (() => {
      const out = new GPIO(GPIO_OUT, GPIO.OUTPUT);
      const inp = new GPIO(GPIO_IN, GPIO.INPUT);
      out.set(true);
      Time.sleep(2);
      return inp.get() ? 1 : 0;
    })
  ).toBe(1)
  .it("low written on the output pin reads back on the input pin")
  .expect(
    (() => {
      const out = new GPIO(GPIO_OUT, GPIO.OUTPUT);
      const inp = new GPIO(GPIO_IN, GPIO.INPUT);
      out.set(false);
      Time.sleep(2);
      return inp.get() ? 1 : 0;
    })
  ).toBe(0)
  .it("toggle is observable on the input pin")
  .expect(
    (() => {
      const out = new GPIO(GPIO_OUT, GPIO.OUTPUT);
      const inp = new GPIO(GPIO_IN, GPIO.INPUT);
      out.set(false);
      Time.sleep(2);
      const before: number = inp.get() ? 1 : 0;
      out.toggle();
      Time.sleep(2);
      const after: number = inp.get() ? 1 : 0;
      return before !== after ? 1 : 0;
    })
  ).toBe(1)
  .it("pull-up input reads the driven low level (drive wins over the pull)")
  .expect(
    (() => {
      const out = new GPIO(GPIO_OUT, GPIO.OUTPUT);
      const inp = new GPIO(GPIO_IN, GPIO.INPUT | GPIO.PULL_UP);
      out.set(false);
      Time.sleep(2);
      return inp.get() ? 1 : 0;
    })
  ).toBe(0)

done();
