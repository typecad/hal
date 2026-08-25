import { describe, done } from '@typecad/expect';
// @typecad-requires-roles adcMax
// ADC raw-read range is board data (10-bit on AVR, 12-bit on STM32/ESP32/
// nRF) — the upper bound comes from the board's test-pins.json rather than a
// hardcoded 4095. Channel-numbered ADC.read(n) coverage lives in
// 12-adc-channels — the Zephyr lowering interprets the numeric argument as a
// GPIO number, so it is only portable where channel n aliases GPIO n.
import { A0, ADC } from '@typecad/board';
import { ADC_MAX } from '@typecad/test-pins';

describe("ADC configuration")
  .it("ADC.getAnalogResolution() returns a positive value")
  .expect(
    (() => {
      const bits = ADC.getAnalogResolution();
      return bits > 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("ADC.setAnalogReference() is callable")
  .expect(
    (() => {
      ADC.setAnalogReference('default');
      return 1;
    })
  ).toBe(1)

describe("InputPin analog helpers")
  .it("InputPin.readAnalog() returns a value within a sane range")
  .expect(
    (() => {
      const v = A0.asInput().readAnalog();
      return (v >= 0 && v <= ADC_MAX) ? 1 : 0;
    })
  ).toBe(1)
  .it("InputPin.readVoltage() returns a non-negative value")
  .expect(
    (() => {
      const v = A0.asInput().readVoltage();
      return v >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("InputPin.getAnalogResolution() returns a positive value")
  .expect(
    (() => {
      const bits = A0.asInput().getAnalogResolution();
      return bits > 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("InputPin.setAnalogReference() is callable")
  .expect(
    (() => {
      A0.asInput().setAnalogReference('default');
      return 1;
    })
  ).toBe(1)
  .it("InputPin.setAnalogReference('internal') is callable")
  .expect(
    (() => {
      A0.asInput().setAnalogReference('internal');
      return 1;
    })
  ).toBe(1)

done();
