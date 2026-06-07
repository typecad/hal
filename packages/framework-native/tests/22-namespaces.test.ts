import { describe, done } from '@typecad/expect';

namespace SensorLib {
  export const BASE = 42;
  export const OFFSET = 8;
}

namespace MathUtils {
  export function twice(x: number): number {
    return x * 2;
  }
}

describe("Namespaced organization")
  .it("namespace constant access")
  .expect(
    (() => {
      return SensorLib.BASE + SensorLib.OFFSET;
    })
  ).toBe(50)
  .it("namespace function call")
  .expect(
    (() => {
      return MathUtils.twice(5);
    })
  ).toBe(10)
  .it("static class method as library")
  .expect(
    (() => {
      class AddrLib {
        static read(): number {
          return 0x68;
        }
      }
      return AddrLib.read();
    })
  ).toBe(0x68)
  .it("class instantiation in IIFE")
  .expect(
    (() => {
      class I2CBusDev {
        address: number;
        constructor(addr: number) {
          this.address = addr;
        }
        getAddress(): number {
          return this.address;
        }
      }
      const bus = new I2CBusDev(0x55);
      return bus.getAddress();
    })
  ).toBe(0x55)

done();
