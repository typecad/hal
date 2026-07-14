import { describe, done } from '@typecad/expect';

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
