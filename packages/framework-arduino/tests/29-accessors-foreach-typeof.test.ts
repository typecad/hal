import { describe, done } from '@typecad/expect';

// ---------------------------------------------------------------------------
// On-hardware tests for the five newly implemented embedded-relevant features:
// 1. Get/set accessors
// 2. forEach inline expansion
// 3. typeof operator (compile-time resolved)
// 4. Union types (std::variant for generic, nullable for Arduino)
// 5. export default (module-level, tested indirectly via import)
// ---------------------------------------------------------------------------

// ── Accessors ──────────────────────────────────────────────────────────────

describe("Getter accessors")
  .it("getter returns field value")
  .expect(
    (() => {
      class Sensor {
        _value: number;
        constructor(v: number) {
          this._value = v;
        }
        get reading(): number {
          return this._value;
        }
      }
      const s = new Sensor(42);
      return s.reading;
    })
  ).toBe(42)
  .it("getter computes derived value")
  .expect(
    (() => {
      class Rect {
        w: number;
        h: number;
        constructor(width: number, height: number) {
          this.w = width;
          this.h = height;
        }
        get area(): number {
          return this.w * this.h;
        }
      }
      const r = new Rect(3, 7);
      return r.area;
    })
  ).toBe(21)

describe("Setter accessors")
  .it("setter updates field value")
  .expect(
    (() => {
      class Counter {
        _count: number;
        constructor() {
          this._count = 0;
        }
        get count(): number {
          return this._count;
        }
        set count(val: number) {
          this._count = val;
        }
      }
      const c = new Counter();
      c.count = 10;
      return c.count;
    })
  ).toBe(10)
  .it("setter clamps value")
  .expect(
    (() => {
      class Bounded {
        _val: number;
        constructor() {
          this._val = 0;
        }
        get val(): number {
          return this._val;
        }
        set val(v: number) {
          if (v > 100) {
            this._val = 100;
          } else {
            this._val = v;
          }
        }
      }
      const b = new Bounded();
      b.val = 200;
      return b.val;
    })
  ).toBe(100)

describe("Getter and setter pair")
  .it("read/write through accessors")
  .expect(
    (() => {
      class Temp {
        _celsius: number;
        constructor() {
          this._celsius = 0;
        }
        get celsius(): number {
          return this._celsius;
        }
        set celsius(c: number) {
          this._celsius = c;
        }
      }
      const t = new Temp();
      t.celsius = 25;
      return t.celsius;
    })
  ).toBe(25)

// ── forEach ────────────────────────────────────────────────────────────────

describe("forEach expansion")
  .it("forEach sums array elements")
  .expect(
    (() => {
      const nums = [1, 2, 3, 4, 5];
      let sum = 0;
      nums.forEach((x: number) => {
        sum += x;
      });
      return sum;
    })
  ).toBe(15)
  .it("forEach with block body counts elements")
  .expect(
    (() => {
      const items = [10, 20, 30];
      let count = 0;
      items.forEach((item: number) => {
        count++;
      });
      return count;
    })
  ).toBe(3)
  .it("forEach modifies external state")
  .expect(
    (() => {
      const values = [2, 4, 6];
      let product = 1;
      values.forEach((v: number) => {
        product *= v;
      });
      return product;
    })
  ).toBe(48)

// ── typeof (compile-time resolution) ───────────────────────────────────────

describe("typeof operator")
  .it("typeof number literal equals number")
  .expect(
    (() => {
      const t = typeof 42;
      return t === "number" ? 1 : 0;
    })
  ).toBe(1)
  .it("typeof string literal equals string")
  .expect(
    (() => {
      const t = typeof "hello";
      return t === "string" ? 1 : 0;
    })
  ).toBe(1)
  .it("typeof boolean literal equals boolean")
  .expect(
    (() => {
      const t = typeof false;
      return t === "boolean" ? 1 : 0;
    })
  ).toBe(1)

// ── Nullable union types (Arduino-safe) ────────────────────────────────────

describe("Nullable union types")
  .it("number | null resolves to number")
  .expect(
    (() => {
      function getNullable(): number | null {
        return 42;
      }
      const val = getNullable();
      return val as number;
    })
  ).toBe(42)
  .it("string | undefined resolves to string")
  .expect(
    (() => {
      function getName(): string | undefined {
        return "test";
      }
      const name = getName();
      return name === "test" ? 1 : 0;
    })
  ).toBe(1)

// ── Accessors with inheritance ─────────────────────────────────────────────

describe("Accessors with inheritance")
  .it("derived class getter uses base field")
  .expect(
    (() => {
      class Base {
        _x: number;
        constructor() {
          this._x = 10;
        }
      }
      class Derived extends Base {
        get doubled(): number {
          return this._x * 2;
        }
      }
      const d = new Derived();
      return d.doubled;
    })
  ).toBe(20)

done();
