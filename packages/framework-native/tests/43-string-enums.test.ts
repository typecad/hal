import { describe, done } from '@typecad/expect';

describe("String enums")
  .it("string enum values auto-assigned and usable in comparisons")
  .expect(
    (() => {
      enum Color {
        Red = 'RED',
        Green = 'GREEN',
        Blue = 'BLUE'
      }
      let result: number = 0;
      const c: Color = Color.Green;
      if (c === Color.Green) {
        result = 1;
      }
      return result;
    })
  ).toBe(1)

  .it("string enum with mixed numeric members")
  .expect(
    (() => {
      enum Status {
        Active = 10,
        Inactive = 'OFF',
        Pending = 'WAIT'
      }
      let result: number = 0;
      if (Status.Active === Status.Active) {
        result = 1;
      }
      return result;
    })
  ).toBe(1)

done();
