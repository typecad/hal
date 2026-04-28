import { describe, done } from '@typehal/expect';

describe("Num fluent chain")
  .it("Num.map().from().to() scales value")
  .expect(
    (() => {
      return Num.map(512).from(0, 1023).to(0, 255);
    })
  ).toBe(127)
  .expect(
    (() => {
      return Num.map(0).from(0, 1023).to(0, 255);
    })
  ).toBe(0)
  .expect(
    (() => {
      return Num.map(1023).from(0, 1023).to(0, 255);
    })
  ).toBe(255)
  .it("Num.map().from().toPercent() maps to 0-100")
  .expect(
    (() => {
      return Num.map(512).from(0, 1024).toPercent();
    })
  ).toBe(50)
  .expect(
    (() => {
      return Num.map(0).from(0, 1024).toPercent();
    })
  ).toBe(0)
  .expect(
    (() => {
      return Num.map(1024).from(0, 1024).toPercent();
    })
  ).toBe(100)
  .it("Num.map().from().toByte() maps to 0-255")
  .expect(
    (() => {
      return Num.map(100).from(0, 100).toByte();
    })
  ).toBe(255)
  .expect(
    (() => {
      return Num.map(0).from(0, 100).toByte();
    })
  ).toBe(0)
  .it("Num.constrain().between() clamps high")
  .expect(
    (() => {
      return Num.constrain(200).between(0, 100);
    })
  ).toBe(100)
  .it("Num.constrain().between() clamps low")
  .expect(
    (() => {
      return Num.constrain(-5).between(0, 100);
    })
  ).toBe(0)
  .it("Num.constrain().between() passes through in range")
  .expect(
    (() => {
      return Num.constrain(50).between(0, 100);
    })
  ).toBe(50)

done();
