import { describe, done } from '@typecad/expect';
import { I2C0 } from '@typecad/board';

describe("I2C0 lifecycle")
  .it("I2C0.begin() is callable")
  .expect(
    (() => {
      I2C0.begin();
      return 1;
    })
  ).toBe(1)
  .it("I2C0.setClock() is callable")
  .expect(
    (() => {
      I2C0.setClock(100000);
      return 1;
    })
  ).toBe(1)
  .it("I2C0.end() is callable")
  .expect(
    (() => {
      I2C0.end();
      return 1;
    })
  ).toBe(1)

describe("I2C0 device accessor")
  .it("I2C0.device(addr).writeByte() is callable")
  .expect(
    (() => {
      I2C0.device(0x68).writeByte(0x00, 0x55);
      return 1;
    })
  ).toBe(1)
  .it("I2C0.device(addr).readByte() is callable")
  .expect(
    (() => {
      I2C0.device(0x68).readByte(0x00);
      return 1;
    })
  ).toBe(1)
  .it("I2C0.device(addr).writeBytes() is callable")
  .expect(
    (() => {
      I2C0.device(0x68).writeBytes(0x00, [0x01, 0x02, 0x03]);
      return 1;
    })
  ).toBe(1)
  .it("I2C0.device(addr).readBytes() is callable")
  .expect(
    (() => {
      I2C0.device(0x68).readBytes(0x00, 2);
      return 1;
    })
  ).toBe(1)

describe("I2C0 bus-level accessors")
  .it("I2C0.writeByte()/readByte() are callable")
  .expect(
    (() => {
      I2C0.writeByte(0x68, 0x00, 0x55);
      I2C0.readByte(0x68, 0x00);
      return 1;
    })
  ).toBe(1)

describe("I2C0 low-level Wire API")
  .it("beginTransmission/write/endTransmission sequence is callable")
  .expect(
    (() => {
      I2C0.beginTransmission(0x68);
      I2C0.write(0x00);
      I2C0.endTransmission(true);
      return 1;
    })
  ).toBe(1)
  .it("requestFrom/available/read sequence is callable")
  .expect(
    (() => {
      I2C0.requestFrom(0x68, 1);
      I2C0.available();
      I2C0.read();
      return 1;
    })
  ).toBe(1)

describe("I2C0 ownership")
  .it("take()/release() with bus alias are callable")
  .expect(
    (() => {
      const bus = I2C0.take();
      bus.beginTransmission(0x68);
      bus.write(0x00);
      bus.endTransmission(true);
      bus.release();
      return 1;
    })
  ).toBe(1)
  .it("direct take()/release() on singleton are callable")
  .expect(
    (() => {
      I2C0.take();
      I2C0.beginTransmission(0x68);
      I2C0.endTransmission(true);
      I2C0.release();
      return 1;
    })
  ).toBe(1)

done();
