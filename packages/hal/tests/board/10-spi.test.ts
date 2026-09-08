import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles cs
// Shared board-level SPI suite, adapted to the thin SPITarget class (the
// ambient SPI0 bus singleton is gone — construction carries the bus, CS pin,
// and clock). The bus has no peer attached, so register reads fail safe to 0
// and transceive/write are callability smoke.
import { CS_PIN } from '@typecad/test-pins';
import { SPITarget } from '@typecad/hal';

describe("SPITarget construction")
  .it("SPITarget(bus, cs, hz) construction is accepted")
  .expect(
    (() => {
      const flash = new SPITarget('SPI0', CS_PIN, { hz: 4_000_000 });
      flash.write([0x9F]);
      return 1;
    })
  ).toBe(1)
  .it("SPITarget with mode and default clock is accepted")
  .expect(
    (() => {
      const flash = new SPITarget('SPI0', CS_PIN, { mode: 3 });
      flash.write([0xFF]);
      return 1;
    })
  ).toBe(1)

describe("SPITarget transfers (empty bus)")
  .it("transceive() into a 4-byte buffer is callable")
  .expect(
    (() => {
      const flash = new SPITarget('SPI0', CS_PIN, { hz: 4_000_000 });
      const id = new Uint8Array(4);
      flash.transceive([0x9F], id);
      return 1;
    })
  ).toBe(1)
  .it("transceive() without an rx buffer is callable")
  .expect(
    (() => {
      const flash = new SPITarget('SPI0', CS_PIN, { hz: 4_000_000 });
      flash.transceive([0x06]);
      return 1;
    })
  ).toBe(1)
  .it("readReg() on an empty bus fails safe to 0")
  .expect(
    (() => {
      const flash = new SPITarget('SPI0', CS_PIN, { hz: 4_000_000 });
      return flash.readReg(0x0F);
    })
  ).toBe(0)

done();
