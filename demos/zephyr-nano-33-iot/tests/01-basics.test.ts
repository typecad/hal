// ---------------------------------------------------------------------------
// Hardware test — Basics
//
// Runs on the board via `npm run test:hw` (cuttlefish-test). Each test file is
// transpiled, flashed to the board, and its assertions are evaluated on the
// host over serial. Change the serial port in cuttlefish.config.ts (the `test.port`
// field) or override it with the CUTTLEFISH_PORT env var.
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/expect';

describe("Basics")
  .it("adds two numbers")
  .expect(
    (() => {
      const a = 1;
      let b = 2;
      return a + b;
    })
  ).toBe(3)
  .it("clamps an ADC millivolt reading to the sam0 full-scale range")
  .expect(
    (() => {
      // ADC_REF_VDD_1_2 → full scale is VDDANA/2 = 1650 mV.
      const mv = 3300;
      return Math.max(0, Math.min(1650, mv));
    })
  ).toBe(1650)
  .it("maps a millivolt reading onto the 0-255 PWM duty range")
  .expect(
    (() => {
      const mv = 728;                        // ~44% of full scale
      const duty = Math.min(255, mv / 7);
      return Math.round(duty);
    })
  ).toBe(104);

done();
