import { describe, done } from '@typecad/expect';

describe("Method templates")
  .it("method with type parameter compiles")
  .expect(
    (() => {
      class Picker {
        x: number;
        y: number;
        constructor() {
          this.x = 10;
          this.y = 20;
        }
        selectField<K extends number>(idx: K): number {
          if (idx === 0) {
            return this.x;
          }
          return this.y;
        }
      }
      const p = new Picker();
      return p.selectField(0) + p.selectField(1);
    })
  ).toBe(30)

done();
