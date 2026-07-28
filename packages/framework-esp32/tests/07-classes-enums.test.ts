import { describe, done } from '@typecad/expect';


describe("Class basics")
  .it("constructor and fields")
  .expect(
    (() => {
      class Point {
        x: number;
        y: number;
        constructor(x: number, y: number) {
          this.x = x;
          this.y = y;
        }
      }
      const p = new Point(3, 4);
      return p.x + p.y;
    })
  ).toBe(7)
  .it("method invocation")
  .expect(
    (() => {
      class Calculator {
        value: number;
        constructor() {
          this.value = 0;
        }
        add(n: number): number {
          this.value += n;
          return this.value;
        }
      }
      const calc = new Calculator();
      calc.add(5);
      calc.add(3);
      return calc.value;
    })
  ).toBe(8)
  .it("method returning value")
  .expect(
    (() => {
      class Rect {
        width: number;
        height: number;
        constructor(w: number, h: number) {
          this.width = w;
          this.height = h;
        }
        area(): number {
          return this.width * this.height;
        }
      }
      const r = new Rect(4, 5);
      return r.area();
    })
  ).toBe(20)

describe("Class inheritance")
  .it("extends with super")
  .expect(
    (() => {
      class Animal {
        name: string;
        constructor(name: string) {
          this.name = name;
        }
        identify(): string {
          return this.name;
        }
      }
      class Dog extends Animal {
        breed: string;
        constructor(name: string, breed: string) {
          super(name);
          this.breed = breed;
        }
      }
      const d = new Dog("Rex", "Shepherd");
      return d.identify().length;
    })
  ).toBe(3)

describe("Static members")
  .it("static method")
  .expect(
    (() => {
      class MathUtils {
        static double(n: number): number {
          return n * 2;
        }
      }
      return MathUtils.double(7);
    })
  ).toBe(14)

describe("This keyword")
  .it("this in method chain")
  .expect(
    (() => {
      class Builder {
        value: number;
        constructor() {
          this.value = 0;
        }
        add(n: number): Builder {
          this.value += n;
          return this;
        }
      }
      const b = new Builder();
      b.add(3).add(7);
      return b.value;
    })
  ).toBe(10)



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

describe("String enums")
  .it("string enum compared to a literal and concatenated")
  .expectString(
    (() => {
      enum Mode { Read = 'read', Write = 'write', Exec = 'exec' }
      const m: Mode = Mode.Write;
      if (m === 'read') { return 'no'; }
      return 'mode ' + m;
    })
  ).toBe("mode write")


done();
