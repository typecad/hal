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

  .it("string enum compared to a string literal")
  .expect(
    (() => {
      enum Color {
        Red = 'RED',
        Green = 'GREEN',
        Blue = 'BLUE'
      }
      let result: number = 0;
      const c: Color = Color.Green;
      if (c === 'GREEN') {
        result = 1;
      }
      if (c === 'RED') {
        result = 2;
      }
      return result;
    })
  ).toBe(1)

  .it("string enum member in string concatenation")
  .expectString(
    (() => {
      enum Color {
        Red = 'RED',
        Green = 'GREEN',
        Blue = 'BLUE'
      }
      const c: Color = Color.Blue;
      return 'color=' + c;
    })
  ).toBe("color=BLUE")

  .it("string enum member directly concatenated with literal")
  .expectString(
    (() => {
      enum StarColor {
        White = 'white',
        Yellow = 'yellow',
        Red = 'red'
      }
      return 'star ' + StarColor.White;
    })
  ).toBe("star white")

describe("String enum with mixed numeric members")
  .it("mixed enum stays numeric (not a string enum)")
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

