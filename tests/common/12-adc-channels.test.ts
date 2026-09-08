import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles adcPin, adcPinAlt, adcMax
// Multi-channel ADC coverage: two distinct analog pads read through their
// own ADC instances (the per-channel setup is synthesized lazily per
// pin — this exercises two channels coexisting on one converter). Pins and
// the converter max come from the board config's test-pins.json.
import { ADC_PIN, ADC_PIN_ALT, ADC_MAX } from '@typecad/test-pins';
import { ADC } from '@typecad/hal';

describe("Multiple ADC channels")
  .it("two channels each read within the converter range")
  .expect(
    (() => {
      const a = new ADC(ADC_PIN);
      const b = new ADC(ADC_PIN_ALT);
      const va = a.read();
      const vb = b.read();
      return (va >= 0 && va <= ADC_MAX && vb >= 0 && vb <= ADC_MAX) ? 1 : 0;
    })
  ).toBe(1)
  .it("interleaved reads stay within range")
  .expect(
    (() => {
      const a = new ADC(ADC_PIN);
      const b = new ADC(ADC_PIN_ALT);
      for (let i = 0; i < 4; i++) {
        const va = a.read();
        const vb = b.read();
        if (va < 0 || va > ADC_MAX || vb < 0 || vb > ADC_MAX) return 0;
      }
      return 1;
    })
  ).toBe(1)

done();
