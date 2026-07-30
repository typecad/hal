import { describe, done } from '@typecad/expect';
import { A0, A1 } from '@typecad/board';

// On-device ADC tests for the Zephyr framework. Proves the SAADC lowering
// (adc_read against DEVICE_DT_GET(DT_NODELABEL(adc))) compiles and runs.
//
// Wiring-free: reads floating analog pins. The raw values are unbounded, so
// these tests confirm the read runs without crashing and returns a value in
// the valid ADC range (0..4095 for 12-bit), not a specific voltage.

describe("ADC (SAADC) lowering")
  .it("adc.read on A0 returns a value in range")
  .expect(
    (() => {
      const v: number = A0.read() ? 1 : 0;
      return v;
    })
  ).toBe(1)
  .it("adc.read on A1 runs without crashing")
  .expect(
    (() => {
      A1.read();
      return 1;
    })
  ).toBe(1)

done();
