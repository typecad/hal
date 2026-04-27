import { describe, done } from '@typecode/expect';

describe("Type checking patterns")
  .it("enum-based type discrimination")
  .expect(
    (() => {
      const DEVICE_SENSOR = 0;
      const DEVICE_ACTUATOR = 1;
      const kind = DEVICE_SENSOR;
      return kind === DEVICE_SENSOR ? 1 : 0;
    })
  ).toBe(1)
  .it("type field discrimination")
  .expect(
    (() => {
      const DEVICE_SENSOR = 0;
      const DEVICE_ACTUATOR = 1;
      const device = { kind: DEVICE_ACTUATOR, value: 42 };
      return device.kind === DEVICE_SENSOR ? device.value : 0;
    })
  ).toBe(0)
  .it("class hierarchy with type field")
  .expect(
    (() => {
      class Dev {
        kind: number;
        constructor(k: number) {
          this.kind = k;
        }
        isSensor(): number {
          return this.kind === 0 ? 1 : 0;
        }
      }
      const d = new Dev(0);
      return d.isSensor();
    })
  ).toBe(1)

done();
