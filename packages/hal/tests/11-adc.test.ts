import { describe, done } from '@typecad/expect';
import { A0, ADC } from '@TypeCAD';

describe("ADC reads")
  .it("ADC.read() on channel 0 returns a value within a sane range")
  .expect(
    (() => {
      const v = ADC.read(0);
      return (v >= 0 && v <= 1023) ? 1 : 0;
    })
  ).toBe(1)
  .it("ADC.read() on channel 1 is callable")
  .expect(
    (() => {
      const v = ADC.read(1);
      return v >= 0 ? 1 : 0;
    })
  ).toBe(1)

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
      return (v >= 0 && v <= 1023) ? 1 : 0;
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
