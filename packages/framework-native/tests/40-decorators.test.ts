import { describe, done } from '@typecad/expect';

describe("Decorators")
  .it("deprecated class still instantiable")
  .expect(
    (() => {
      class OldService {
        value: number;
        constructor() {
          this.value = 42;
        }
      }
      const s = new OldService();
      return s.value;
    })
  ).toBe(42)

done();
