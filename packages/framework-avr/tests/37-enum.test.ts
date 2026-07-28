import { describe, done } from '@typecad/expect';

// ---------------------------------------------------------------------------
// Enum stress test — hardware expect tests for the enum fixes (Findings A/B/C).
// These transpile, compile, and run on real AVR hardware via cuttlefish-test.
//
// NOTE: The expect preprocessor wraps each `.expect(fn)` body in a function
// with `auto` return type, which avr-gcc rejects for enum-returning tests.
// So every test body returns a NUMBER (via explicit computation), never a raw
// enum value. Enum-to-number conversions happen inside the body.
// ---------------------------------------------------------------------------

const enum Mode { Idle, Run, Stop, Error }
const enum Code { Ok = 0, NotFound = 404, ServerError = 500 }
const enum Color { Red = "red", Green = "green", Blue = "blue" }
const enum Flags { None = 0, A = 1, B = 2, C = 4, All = 7 }

// Top-level const typed as a numeric enum (Finding B fix — file-scope global).
const defaultMode: Mode = Mode.Run;

const PRIORITY: number[] = [10, 20, 30, 40];

describe("Numeric enum basics")
  .it("enum member value")
  .expect(
    (() => {
      const m: Mode = Mode.Run;
      return PRIORITY[m];
    })
  ).toBe(20)
  .it("enum with gaps")
  .expect(
    (() => {
      const c: Code = Code.NotFound;
      return c >= Code.ServerError ? 1 : 0;
    })
  ).toBe(0)

describe("Enum relational comparison")
  .it("greater-or-equal")
  .expect(
    (() => {
      const a: Code = Code.ServerError;
      const b: Code = Code.NotFound;
      return a >= b ? 1 : 0;
    })
  ).toBe(1)

describe("Enum as array index")
  .it("index into array")
  .expect(
    (() => {
      return PRIORITY[Mode.Run];
    })
  ).toBe(20)

describe("Enum in switch")
  .it("switch on enum returns correct case")
  .expect(
    (() => {
      switch (Mode.Error) {
        case Mode.Idle: return 0;
        case Mode.Run: return 1;
        case Mode.Stop: return 2;
        case Mode.Error: return 3;
        default: return -1;
      }
    })
  ).toBe(3)

describe("String enum")
  .it("string enum comparison")
  .expect(
    (() => {
      const c: string = Color.Green;
      return c === Color.Green ? 1 : 0;
    })
  ).toBe(1)

describe("Enum↔int storage boundary (Finding C)")
  .it("int to enum via as cast and back")
  .expect(
    (() => {
      const n: number = 1;
      const m: Mode = n as Mode;
      const p: number = packMode(m);
      return p;
    })
  ).toBe(1)

describe("Bitwise flags")
  .it("OR flags and check")
  .expect(
    (() => {
      const flags: number = (Flags.A as number) | (Flags.C as number);
      return (flags & (Flags.A as number)) !== 0 ? 1 : 0;
    })
  ).toBe(1)

describe("Top-level const enum (Finding B)")
  .it("top-level const accessible from function")
  .expect(
    (() => {
      return PRIORITY[defaultMode];
    })
  ).toBe(20)

function packMode(m: Mode): number {
  return m;
}

done();
