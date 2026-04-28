import { describe, done } from '@typehal/expect';

describe("Abstract classes")
  .it("abstract class with concrete subclass")
  .expect(
    (() => {
      abstract class AbsReader {
        abstract read(): number;
      }
      class ConReader extends AbsReader {
        read(): number {
          return 25;
        }
      }
      const s = new ConReader();
      return s.read();
    })
  ).toBe(25)
  .it("abstract class with field and subclass")
  .expect(
    (() => {
      abstract class AbsPeripheral {
        addr: number;
        constructor(a: number) {
          this.addr = a;
        }
        abstract getKind(): number;
      }
      class I2CDev extends AbsPeripheral {
        constructor(a: number) {
          super(a);
        }
        getKind(): number {
          return 1;
        }
      }
      const dev = new I2CDev(0x68);
      return dev.addr + dev.getKind();
    })
  ).toBe(0x69)
  .it("abstract class with multiple concrete subclasses")
  .expect(
    (() => {
      abstract class AbsPin {
        abstract getNum(): number;
      }
      class DigiPin extends AbsPin {
        n: number;
        constructor(n: number) {
          super();
          this.n = n;
        }
        getNum(): number {
          return this.n;
        }
      }
      class AnaPin extends AbsPin {
        n: number;
        constructor(n: number) {
          super();
          this.n = n + 100;
        }
        getNum(): number {
          return this.n;
        }
      }
      const d = new DigiPin(5);
      const a = new AnaPin(0);
      return d.getNum() + a.getNum();
    })
  ).toBe(105)

done();
