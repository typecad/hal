// @typecad-requires-roles i2cBus
import { describe, done } from '@typecad/hal/testing';
// I2C suite, adapted to the thin I2CTarget class (the ambient I2C0 bus
// singleton and .device() chains are gone — construction carries the bus and
// the 7-bit address). The bus has no peer attached, so register reads fail
// safe to 0 and writes are callability smoke.
import { I2CTarget } from '@typecad/hal';
import { I2C_BUS } from '@typecad/test-pins';

describe("I2CTarget construction")
  .it("I2CTarget(bus, address) construction is accepted")
  .expect(
    (() => {
      const dev = new I2CTarget(I2C_BUS, 0x68);
      dev.writeReg(0x00, 0x55);
      return 1;
    })
  ).toBe(1)
  .it("I2CTarget with fast-mode clock is accepted")
  .expect(
    (() => {
      const dev = new I2CTarget(I2C_BUS, 0x44, { hz: 400_000 });
      dev.writeReg(0x32, 0x00);
      return 1;
    })
  ).toBe(1)

describe("I2CTarget register ops (empty bus)")
  .it("readReg() on an empty bus fails safe to 0")
  .expect(
    (() => {
      const dev = new I2CTarget(I2C_BUS, 0x44);
      return dev.readReg(0x32);
    })
  ).toBe(0)
  .it("updateReg() is callable without crashing")
  .expect(
    (() => {
      const dev = new I2CTarget(I2C_BUS, 0x44);
      dev.updateReg(0x2C, 0x80, 0x00);
      return 1;
    })
  ).toBe(1)
  .it("write() with a raw buffer is callable")
  .expect(
    (() => {
      const dev = new I2CTarget(I2C_BUS, 0x44);
      dev.write([0x2C, 0x06]);
      return 1;
    })
  ).toBe(1)

done();
