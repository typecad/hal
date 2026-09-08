import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles adcPin, adcMax
// ADC suite, adapted to the thin ADC class (construction IS the
// channel setup — gain/reference are constructor options defaulting to the
// chip descriptor's pair). The analog-capable pin comes from the board
// config's test-pins.json; silicon routes harvested from the SoC pinctrl
// files decide which pads qualify per board. A floating pad reads noise —
// assert the raw counts stay within the converter's range, not a value.
import { ADC_PIN, ADC_MAX } from '@typecad/test-pins';
import { ADC } from '@typecad/hal';

describe("ADC reads")
  .it("read() returns raw counts within the converter range")
  .expect(
    (() => {
      const sense = new ADC(ADC_PIN);
      const v = sense.read();
      return v >= 0 && v <= ADC_MAX ? 1 : 0;
    })
  ).toBe(1)
  .it("consecutive reads are each within range")
  .expect(
    (() => {
      const sense = new ADC(ADC_PIN);
      const a = sense.read();
      const b = sense.read();
      return (a >= 0 && a <= ADC_MAX && b >= 0 && b <= ADC_MAX) ? 1 : 0;
    })
  ).toBe(1)

describe("ADC options")
  .it("explicit gain/reference construction is accepted")
  .expect(
    (() => {
      const sense = new ADC(ADC_PIN, { gain: ADC.GAIN_1, reference: ADC.REF_INTERNAL });
      sense.read();
      return 1;
    })
  ).toBe(1)

done();
