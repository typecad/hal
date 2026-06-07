import { describe, done } from '@typecad/expect';

describe("Computed enum values")
  .it("bitwise shift")
  .expect(
    (() => {
      enum Flags {
        A = 1 << 3
      }
      return Flags.A;
    })
  ).toBe(8)
  .it("bitwise OR of members")
  .expect(
    (() => {
      enum Perm {
        Read = 1,
        Write = 2,
        Execute = 4,
        All = Read | Write | Execute
      }
      return Perm.All;
    })
  ).toBe(7)
  .it("reference to prior member")
  .expect(
    (() => {
      enum Steps {
        First = 10,
        Second = First,
        Third = Second + 5
      }
      return Steps.Third;
    })
  ).toBe(15)
  .it("parenthesized expression")
  .expect(
    (() => {
      enum Mask {
        Low = (1 << 4) | 0x0F
      }
      return Mask.Low;
    })
  ).toBe(31)
  .it("arithmetic in enum")
  .expect(
    (() => {
      enum Calc {
        A = 3 * 7,
        B = A + 1,
        C = B / 2
      }
      return Calc.C;
    })
  ).toBe(11)
  .it("XOR result value")
  .expect(
    (() => {
      enum Bits {
        A = 0xFF,
        B = 0x0F,
        C = A ^ B
      }
      return Bits.C;
    })
  ).toBe(240)
  .it("AND result value")
  .expect(
    (() => {
      enum Bits2 {
        A = 0xFF,
        B = 0x0F,
        C = A & B
      }
      return Bits2.C;
    })
  ).toBe(15)
  .it("auto-increment after computed")
  .expect(
    (() => {
      enum Mixed {
        X = 10,
        Y,
        Z
      }
      return Mixed.Z;
    })
  ).toBe(12)

done();
