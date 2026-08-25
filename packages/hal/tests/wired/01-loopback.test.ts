import { describe, done } from '@typecad/expect';
// @typecad-requires-roles gpioOut, gpioIn
// WIRED TIER — not part of the default per-board runs (the board configs'
// include patterns cover common/ and board/ only). Run explicitly with:
//
//   npm run test:hw --workspace @typecad/hal -- --config boards/<board>.config.ts \
//     --include 'tests/wired/*.test.ts'
//
// WIRING: one jumper from the board's gpioOut test pin to its gpioIn test
// pin (names in the board package's test-pins.json). This is where the HAL
// stops being smoke-tested: an output level written on real silicon is read
// back through a real input buffer, proving the full pinMode/digitalWrite/
// digitalRead path end to end.
import { GPIO_OUT, GPIO_IN } from '@typecad/test-pins';
import { Timing } from '@typecad/hal';

describe("Wired GPIO output-to-input loopback")
  .it("high written on the output pin reads back on the input pin")
  .expect(
    (() => {
      const out = GPIO_OUT.asOutput();
      const inp = GPIO_IN.asInput();
      out.high();
      Timing.delay(2);
      return inp.read() ? 1 : 0;
    })
  ).toBe(1)
  .it("low written on the output pin reads back on the input pin")
  .expect(
    (() => {
      const out = GPIO_OUT.asOutput();
      const inp = GPIO_IN.asInput();
      out.low();
      Timing.delay(2);
      return inp.read() ? 0 : 1;
    })
  ).toBe(0)
  .it("toggle is observable on the input pin")
  .expect(
    (() => {
      const out = GPIO_OUT.asOutput();
      const inp = GPIO_IN.asInput();
      out.low();
      Timing.delay(2);
      const before: number = inp.read() ? 1 : 0;
      out.toggle();
      Timing.delay(2);
      const after: number = inp.read() ? 1 : 0;
      return before !== after ? 1 : 0;
    })
  ).toBe(1)
  .it("write() with a runtime value propagates")
  .expect(
    (() => {
      const out = GPIO_OUT.asOutput();
      const inp = GPIO_IN.asInput();
      const v: number = 1;
      out.write(v);
      Timing.delay(2);
      return inp.read() ? 1 : 0;
    })
  ).toBe(1)

done();
