import { describe, done } from '@typecad/expect';
import { D10, SPI0 } from '@TypeCAD';

describe("SPI0 lifecycle")
  .it("SPI0.begin() is callable")
  .expect(
    (() => {
      SPI0.begin();
      return 1;
    })
  ).toBe(1)
  .it("SPI0.end() is callable")
  .expect(
    (() => {
      SPI0.end();
      return 1;
    })
  ).toBe(1)

describe("SPI0 configuration")
  .it("SPI0.setFrequency() is callable")
  .expect(
    (() => {
      SPI0.setFrequency(1000000);
      return 1;
    })
  ).toBe(1)
  .it("SPI0.beginTransaction() / endTransaction() pair")
  .expect(
    (() => {
      SPI0.beginTransaction({});
      SPI0.endTransaction();
      return 1;
    })
  ).toBe(1)
  .it("SPI0.setMode() is callable")
  .expect(
    (() => {
      SPI0.setMode(0);
      return 1;
    })
  ).toBe(1)
  .it("SPI0.setBitOrder() is callable")
  .expect(
    (() => {
      SPI0.setBitOrder('msb');
      return 1;
    })
  ).toBe(1)
  .it("SPI0.setBitOrder('lsb') is callable")
  .expect(
    (() => {
      SPI0.setBitOrder('lsb');
      return 1;
    })
  ).toBe(1)

describe("SPI0 transfers")
  .it("SPI0.transfer() is callable")
  .expect(
    (() => {
      SPI0.transfer(0xFF);
      return 1;
    })
  ).toBe(1)
  .it("SPI0.write() is callable")
  .expect(
    (() => {
      SPI0.write(0xAA);
      return 1;
    })
  ).toBe(1)
  .it("SPI0.write16() is callable")
  .expect(
    (() => {
      SPI0.write16(0x1234);
      return 1;
    })
  ).toBe(1)

describe("SPI0 device accessor")
  .it("SPI0.device(cs).write() is callable")
  .expect(
    (() => {
      SPI0.device(D10).write(0x3C);
      return 1;
    })
  ).toBe(1)
  .it("SPI0.device(cs).transfer() is callable")
  .expect(
    (() => {
      SPI0.device(D10).transfer(0x55);
      return 1;
    })
  ).toBe(1)
  .it("SPI0.device(cs).writeRegister() is callable")
  .expect(
    (() => {
      SPI0.device(D10).writeRegister(0x00, 0x01);
      return 1;
    })
  ).toBe(1)
  .it("SPI0.device(cs).readRegister() is callable")
  .expect(
    (() => {
      SPI0.device(D10).readRegister(0x00, 1);
      return 1;
    })
  ).toBe(1)

describe("SPI0 ownership")
  .it("take()/release() with bus alias are callable")
  .expect(
    (() => {
      const bus = SPI0.take();
      bus.transfer(0x42);
      bus.release();
      return 1;
    })
  ).toBe(1)

done();
