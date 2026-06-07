import { describe, done } from '@typecad/expect';

describe("Enum basics")
  .it("enum member values")
  .expect(
    (() => {
      enum Direction {
        Up,
        Down,
        Left,
        Right
      }
      return Direction.Up;
    })
  ).toBe(0)
  .expect(
    (() => {
      enum Direction {
        Up,
        Down,
        Left,
        Right
      }
      return Direction.Right;
    })
  ).toBe(3)
  .it("enum with explicit values")
  .expect(
    (() => {
      enum Status {
        Ok = 200,
        NotFound = 404,
        Error = 500
      }
      return Status.Ok;
    })
  ).toBe(200)
  .expect(
    (() => {
      enum Status {
        Ok = 200,
        NotFound = 404,
        Error = 500
      }
      return Status.Error;
    })
  ).toBe(500)
  .it("enum with mixed auto and explicit")
  .expect(
    (() => {
      enum Flags {
        None = 0,
        Read = 1,
        Write = 2,
        Execute // auto-incremented to 3
      }
      return Flags.Execute;
    })
  ).toBe(3)
  .it("enum with negative values")
  .expect(
    (() => {
      enum Code {
        Invalid = -1,
        Unknown = -2
      }
      return Code.Invalid;
    })
  ).toBe(-1)

describe("Const enum")
  .it("const enum values")
  .expect(
    (() => {
      const enum Color {
        Red = 0xFF0000,
        Green = 0x00FF00,
        Blue = 0x0000FF
      }
      return Color.Red;
    })
  ).toBe(0xFF0000)

done();
