import { describe, done } from '@typecad/expect';

interface SensorLike {
  read(): number;
}

describe("Interfaces")
  .it("class implementing interface")
  .expect(
    (() => {
      class AnalogSensor implements SensorLike {
        pin: number;
        constructor(p: number) {
          this.pin = p;
        }
        read(): number {
          return this.pin * 10;
        }
      }
      const s = new AnalogSensor(3);
      return s.read();
    })
  ).toBe(30)
  .it("class with configure method")
  .expect(
    (() => {
      class SmartSensor implements SensorLike {
        setting: number;
        constructor() {
          this.setting = 1;
        }
        read(): number {
          return this.setting * 100;
        }
        configure(s: number): void {
          this.setting = s;
        }
      }
      const s = new SmartSensor();
      s.configure(5);
      return s.read();
    })
  ).toBe(500)
  .it("sensor reading via method")
  .expect(
    (() => {
      class Thermistor implements SensorLike {
        offset: number;
        constructor() {
          this.offset = 0;
        }
        read(): number {
          return 22 + this.offset;
        }
        setOffset(o: number): void {
          this.offset = o;
        }
      }
      const t = new Thermistor();
      t.setOffset(5);
      return t.read();
    })
  ).toBe(27)
  .it("named sensor with configure and read")
  .expect(
    (() => {
      class NamedSensor implements SensorLike {
        factor: number;
        constructor() {
          this.factor = 1;
        }
        read(): number {
          return 42 * this.factor;
        }
        setFactor(f: number): void {
          this.factor = f;
        }
      }
      const s = new NamedSensor();
      s.setFactor(2);
      return s.read();
    })
  ).toBe(84)

done();
