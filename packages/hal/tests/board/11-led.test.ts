import { describe, done } from '@typecad/expect';
// @typecad-requires-roles led
// LED alias coverage, split out of the constants group so it can run on any
// board whose package declares the `led` role (active-low boards are honored
// through their led0 DT spec — the alias drives logical levels).
import { LED_PIN } from '@typecad/test-pins';

describe("Board LED alias")
  .it("LED alias is usable as an output Pin")
  .expect(
    (() => {
      LED_PIN.asOutput();
      LED_PIN.high();
      LED_PIN.low();
      return 1;
    })
  ).toBe(1)
  .it("LED alias toggle is callable")
  .expect(
    (() => {
      LED_PIN.toggle();
      return 1;
    })
  ).toBe(1)

done();
