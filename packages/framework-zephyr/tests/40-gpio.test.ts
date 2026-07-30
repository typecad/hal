import { describe, done } from '@typecad/expect';
import { LED, D0, D1 } from '@typecad/board';
import { Timing } from '@typecad/hal';

// On-device GPIO tests for the Zephyr framework. Proves the devicetree-spec
// bridge (gpio_pin_*_dt) compiles (via west build), flashes to the XIAO
// nRF52840, and drives real silicon.
//
// Wiring-free: relies on the onboard LED (active-low, driven via the led0 DT
// alias) and internal pullups on the D-pins. Output→input loopback would
// require a physical jumper and is intentionally omitted.

describe("GPIO devicetree-spec lowering")
  .it("onboard LED output high/low compiles and runs")
  .expect(
    (() => {
      const out = LED.asOutput();
      out.high();
      Timing.delay(1);
      out.low();
      return 1;
    })
  ).toBe(1)
  .it("LED toggle runs without crashing")
  .expect(
    (() => {
      const out = LED.asOutput();
      out.toggle();
      Timing.delay(1);
      out.toggle();
      return 1;
    })
  ).toBe(1)
  .it("input pullup reads HIGH on a floating pin (D0)")
  .expect(
    (() => {
      const pin = D0.asInputPullUp();
      Timing.delay(1);
      return pin.read() ? 1 : 0;
    })
  ).toBe(1)
  .it("input pullup reads HIGH on a floating pin (D1)")
  .expect(
    (() => {
      const pin = D1.asInputPullUp();
      Timing.delay(1);
      return pin.read() ? 1 : 0;
    })
  ).toBe(1)
  .it("output write with a runtime value runs without crashing")
  .expect(
    (() => {
      const out = LED.asOutput();
      const v: number = 1;
      out.write(v);
      Timing.delay(1);
      out.write(0);
      return 1;
    })
  ).toBe(1)

done();
