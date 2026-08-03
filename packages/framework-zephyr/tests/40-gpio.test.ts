import { describe, done } from '@typecad/expect';
import { LED, D4, D5 } from '@typecad/board';
import { Timing } from '@typecad/hal';

// On-device GPIO tests for the Zephyr framework. Proves the devicetree-spec
// bridge (gpio_pin_*_dt) compiles (via west build), flashes to the board,
// and drives real silicon.
//
// Wiring-free: relies on the onboard LED and internal pullups on the D-pins.
// Output→input loopback would require a physical jumper and is intentionally
// omitted. D0 (GPIO0 / BOOT button on ESP32) is avoided — its DT-spec read
// path can block on the active-low button circuitry.

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
  .it("input pullup reads HIGH on a floating pin (D4)")
  .expect(
    (() => {
      const pin = D4.asInputPullUp();
      Timing.delay(1);
      return pin.read() ? 1 : 0;
    })
  ).toBe(1)
  .it("input pullup reads HIGH on a floating pin (D5)")
  .expect(
    (() => {
      const pin = D5.asInputPullUp();
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
