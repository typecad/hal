import { describe, done } from '@typecad/expect';

// Regression tests for the string/enum usage patterns reported as broken:
//  - String enum comparison against a string literal
//  - String enum member in string concatenation
//  - Numeric enum member in string concatenation (was: std::to_string(enum) error)
//  - String method result in string concatenation (was: std::to_string(upper) error)

describe("Numeric enum in concatenation")
  .it("numeric enum value interpolated into a string")
  .expect(
    (() => {
      enum Level { Low = 1, Medium = 5, High = 9 }
      const l: Level = Level.High;
      let ok = 0;
      if ('level=' + l === 'level=9') { ok = 1; }
      return ok;
    })
  ).toBe(1)

describe("String method result in concatenation")
  .it("toUpperCase result concatenated with a literal")
  .expectString(
    (() => {
      const text = 'starfield';
      return 'Upper ' + text.toUpperCase();
    })
  ).toBe("Upper STARFIELD")

  .it("toLowerCase result concatenated with a literal")
  .expectString(
    (() => {
      const text = 'STARFIELD';
      return 'lower ' + text.toLowerCase();
    })
  ).toBe("lower starfield")

describe("Float concatenation")
  .it("float value in concatenation keeps full precision")
  .expectString(
    (() => {
      const pi = 3.14159;
      return 'area ' + pi;
    })
  ).toBe("area 3.14159")

  .it("large integer-valued number does not use scientific notation")
  .expect(
    (() => {
      const n = 16711680;
      let ok = 0;
      if ('n=' + n === 'n=16711680') { ok = 1; }
      return ok;
    })
  ).toBe(1)

describe("String enum round-trip")
  .it("string enum compared and concatenated together")
  .expectString(
    (() => {
      enum Mode { Read = 'read', Write = 'write', Exec = 'exec' }
      const m: Mode = Mode.Write;
      if (m === 'read') { return 'no'; }
      return 'mode=' + m;
    })
  ).toBe("mode=write")

done();
