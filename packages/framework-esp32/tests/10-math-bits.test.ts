import { describe, done } from '@typecad/expect';


describe("Math functions")
  .it("Math.round")
  .expect(
    (() => {
      return Math.round(3.7);
    })
  ).toBe(4)
  .expect(
    (() => {
      return Math.round(3.2);
    })
  ).toBe(3)
  .expect(
    (() => {
      return Math.round(3.5);
    })
  ).toBe(4)
  .it("Math.floor")
  .expect(
    (() => {
      return Math.floor(3.9);
    })
  ).toBe(3)
  .expect(
    (() => {
      return Math.floor(-1.1);
    })
  ).toBe(-2)
  .it("Math.ceil")
  .expect(
    (() => {
      return Math.ceil(3.1);
    })
  ).toBe(4)
  .expect(
    (() => {
      return Math.ceil(-1.9);
    })
  ).toBe(-1)
  .it("Math.abs")
  .expect(
    (() => {
      return Math.abs(-42);
    })
  ).toBe(42)
  .expect(
    (() => {
      return Math.abs(42);
    })
  ).toBe(42)
  .it("Math.pow")
  .expect(
    (() => {
      return Math.pow(2, 8);
    })
  ).toBe(256)
  .expect(
    (() => {
      return Math.pow(10, 3);
    })
  ).toBe(1000)
  .it("Math.sqrt")
  .expect(
    (() => {
      return Math.sqrt(144);
    })
  ).toBe(12)
  .expect(
    (() => {
      return Math.sqrt(256);
    })
  ).toBe(16)

done();

describe("Bit mask constants")
  .it("named bit flags combined with OR")
  .expect(
    (() => {
      const TX_ENABLE = 0x01;
      const RX_ENABLE = 0x02;
      const PARITY_EN = 0x04;
      const flags = TX_ENABLE | RX_ENABLE | PARITY_EN;
      return flags;
    })
  ).toBe(0x07)
  .it("compound OR assignment to set flag")
  .expect(
    (() => {
      const TX_ENABLE = 0x01;
      const RX_ENABLE = 0x02;
      let flags = 0;
      flags |= TX_ENABLE;
      flags |= RX_ENABLE;
      return flags;
    })
  ).toBe(0x03)
  .it("AND check for flag presence")
  .expect(
    (() => {
      const RX_ENABLE = 0x02;
      const flags = 0x03;
      return (flags & RX_ENABLE) ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      const PARITY_EN = 0x04;
      const flags = 0x03;
      return (flags & PARITY_EN) ? 1 : 0;
    })
  ).toBe(0)
  .it("clear flag with AND NOT")
  .expect(
    (() => {
      const TX_ENABLE = 0x01;
      const RX_ENABLE = 0x02;
      let flags = 0x03;
      flags &= ~TX_ENABLE;
      return flags;
    })
  ).toBe(0x02)
  .it("bit shift for position")
  .expect(
    (() => {
      return (1 << 3);
    })
  ).toBe(8)
  .expect(
    (() => {
      return (1 << 7);
    })
  ).toBe(128)
  .it("multi-byte register packing")
  .expect(
    (() => {
      const high = 0x0A;
      const low = 0x1F;
      return (high << 8) | low;
    })
  ).toBe(0x0A1F)
  .it("multi-byte register unpacking")
  .expect(
    (() => {
      const reg = 0x0A1F;
      const high = (reg >> 8) & 0xFF;
      const low = reg & 0xFF;
      return (high << 8) | low;
    })
  ).toBe(0x0A1F)
  .it("toggle bits with XOR")
  .expect(
    (() => {
      const LED_PIN = 0x01;
      let port = 0x00;
      port ^= LED_PIN;
      const first = port;
      port ^= LED_PIN;
      const second = port;
      return (first << 8) | second;
    })
  ).toBe(0x0100)

done();
done();
