import { describe, done } from '@typecad/expect';
// @typecad-requires-roles adcMax
// ADC.read(channel) takes a channel NUMBER (the Arduino-compat form). The
// Zephyr lowering resolves it via the chip descriptor's channel map —
// pin-first (readAnalog's GPIO-number form), then by channel index, so
// channel n need not alias GPIO n (XIAO AIN2 = P0.28, ESP32 CH0 = GPIO36).
// The portable pin-based form (A0.readAnalog()) lives in 11-adc.
import { ADC } from '@typecad/board';
import { ADC_MAX } from '@typecad/test-pins';

describe("ADC channel-numbered reads")
  .it("ADC.read() on channel 0 returns a value within a sane range")
  .expect(
    (() => {
      const v = ADC.read(0);
      return (v >= 0 && v <= ADC_MAX) ? 1 : 0;
    })
  ).toBe(1)
  .it("ADC.read() on channel 1 is callable")
  .expect(
    (() => {
      const v = ADC.read(1);
      return v >= 0 ? 1 : 0;
    })
  ).toBe(1)

done();
