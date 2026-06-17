import { describe, it, expect } from 'vitest';
import { expectCppContains, expectCppNotContains, transpile, transpileArduino, findDiagnostics, hasInclude } from './setup';

// ---------------------------------------------------------------------------
// Tests for the five newly implemented embedded-relevant features:
// 1. Get/set accessors
// 2. forEach inline expansion
// 3. typeof operator
// 4. Full union types (std::variant)
// 5. export default support
// ---------------------------------------------------------------------------

describe('Get/Set Accessors', () => {
  it('transpiles getter in class', () => {
    const result = transpile(`
      class Sensor {
        private _value: int = 0;
        public get value(): int {
          return this._value;
        }
      }
      function test(): int {
        const s = new Sensor();
        return s.value;
      }
    `);
    expectCppContains(result, ['getValue() const', 'return']);
  });

  it('transpiles setter in class', () => {
    const result = transpile(`
      class Sensor {
        private _value: int = 0;
        public set value(v: int) {
          this._value = v;
        }
      }
      function test(): void {
        const s = new Sensor();
        s.value = 10;
      }
    `);
    expectCppContains(result, ['void setValue(int v)']);
  });

  it('transpiles getter and setter pair', () => {
    const result = transpile(`
      class Thermometer {
        private _temp: int = 0;
        public get temperature(): int {
          return this._temp;
        }
        public set temperature(t: int) {
          this._temp = t;
        }
      }
      function test(): int {
        const t = new Thermometer();
        t.temperature = 25;
        return t.temperature;
      }
    `);
    expectCppContains(result, ['getTemperature() const', 'void setTemperature(int t)']);
  });

  it('places public accessors in public section', () => {
    const result = transpile(`
      class Box {
        private _size: int = 0;
        public get size(): int {
          return this._size;
        }
      }
      function test(): int {
        const b = new Box();
        return b.size;
      }
    `);
    const { cpp } = result;
    const publicIdx = cpp.indexOf('public:');
    const getterIdx = cpp.indexOf('getSize()');
    const privateIdx = cpp.indexOf('private:');
    expect(publicIdx).toBeGreaterThan(-1);
    expect(getterIdx).toBeGreaterThan(publicIdx);
    expect(privateIdx).toBeGreaterThan(getterIdx);
  });

  it('handles private getter', () => {
    const result = transpile(`
      class Internal {
        private get secret(): int {
          return 42;
        }
        public read(): int {
          return this.secret;
        }
      }
      function test(): int {
        const i = new Internal();
        return i.read();
      }
    `);
    expectCppContains(result, ['getSecret() const']);
  });

  it('handles protected setter', () => {
    const result = transpile(`
      class Base {
        protected set data(v: int) {
          const x = v;
        }
        public write(val: int): void {
          this.data = val;
        }
      }
      function test(): void {
        const b = new Base();
        b.write(5);
      }
    `);
    expectCppContains(result, ['void setData(int v)']);
  });

  it('transpiles static getter', () => {
    const result = transpile(`
      class Config {
        public static get version(): int {
          return 1;
        }
      }
      function test(): int {
        return Config.version;
      }
    `);
    // Static methods cannot be `const` (no `this`); the cv-qualifier is dropped
    // (demo #8 fix B). The call site `Config.version` rewrites to
    // `Config::getVersion()` (demo #14 Finding E).
    expectCppContains(result, ['static int getVersion()']);
    expectCppContains(result, ['Config::getVersion()']);
  });

  it('transpiles accessor with computed return', () => {
    const result = transpile(`
      class Rect {
        public w: int;
        public h: int;
        constructor(width: int, height: int) {
          this.w = width;
          this.h = height;
        }
        public get area(): int {
          return this.w * this.h;
        }
      }
      function test(): int {
        const r = new Rect(3, 7);
        return r.area;
      }
    `);
    expectCppContains(result, ['getArea() const']);
  });
});

describe('forEach Inline Expansion', () => {
  it('expands forEach with expression body as standalone statement', () => {
    const result = transpile(`
      function process(): void {
        const data = [10, 20, 30];
        data.forEach((x: number) => console.log(x));
      }
    `);
    expectCppNotContains(result, ['forEach']);
    expectCppContains(result, ['for']);
  });

  it('expands forEach with block body', () => {
    const result = transpile(`
      function sum(): void {
        const items = [1, 2, 3];
        let total = 0;
        items.forEach((item: number) => {
          total += item;
        });
      }
    `);
    expectCppNotContains(result, ['forEach']);
    expectCppContains(result, ['for']);
  });
});

describe('typeof Operator', () => {
  it('resolves typeof numeric literal to "number"', () => {
    const result = transpile(`
      function check(): void {
        const t = typeof 10;
      }
    `);
    expectCppContains(result, ['"number"']);
  });

  it('resolves typeof string literal to "string"', () => {
    const result = transpile(`
      function check(): void {
        const t = typeof "hello";
      }
    `);
    expectCppContains(result, ['"string"']);
  });

  it('resolves typeof boolean literal to "boolean"', () => {
    const result = transpile(`
      function check(): void {
        const t = typeof true;
      }
    `);
    expectCppContains(result, ['"boolean"']);
  });

  it('resolves typeof variable from inferred type', () => {
    const result = transpile(`
      function check(): void {
        const x: number = 42;
        const t = typeof x;
      }
    `);
    expectCppContains(result, ['"number"']);
  });

  it('optimizes typeof type guard with matching type to true', () => {
    const result = transpile(`
      function check(x: number): boolean {
        return typeof x === "number";
      }
    `);
    expectCppContains(result, ['true']);
  });

  it('optimizes typeof type guard with mismatched type to false', () => {
    const result = transpile(`
      function check(x: number): boolean {
        return typeof x === "string";
      }
    `);
    expectCppContains(result, ['false']);
  });

  it('optimizes typeof type guard with negation', () => {
    const result = transpile(`
      function check(x: number): boolean {
        return typeof x !== "string";
      }
    `);
    expectCppContains(result, ['true']);
  });
});

describe('Full Union Types (std::variant)', () => {
  it('resolves number | string to std::variant', () => {
    const result = transpile(`
      function getValue(): number | string {
        return 42;
      }
    `);
    expectCppContains(result, ['std::variant<double, std::string>']);
  });

  it('strips null from multi-type union', () => {
    const result = transpile(`
      function getMaybe(): number | string | null {
        return 42;
      }
    `);
    expectCppContains(result, ['std::variant<double, std::string>']);
    expectCppNotContains(result, ['auto getMaybe']);
  });

  it('still resolves nullable unions (number | null) to plain int', () => {
    const result = transpile(`
      function getValue(): number | null {
        return 42;
      }
    `);
    expectCppContains(result, ['double getValue()']);
    expectCppNotContains(result, ['std::variant']);
  });

  it('deduplicates identical union member types', () => {
    const result = transpile(`
      function getVal(): number | number {
        return 42;
      }
    `);
    expectCppContains(result, ['double getVal()']);
  });
});

describe('Discriminated unions', () => {
  it('transpiles discriminated union to std::variant with struct variants', () => {
    const result = transpile(`
      type Event = 
        | { type: "reading"; value: number }
        | { type: "alert"; message: string };
      function handleEvent(event: Event): string {
        return event.type;
      }
    `);
    expectCppContains(result, ['std::variant<_Event_Variant_0, _Event_Variant_1>']);
    expectCppContains(result, ['struct _Event_Variant_0']);
    expectCppContains(result, ['struct _Event_Variant_1']);
  });

  it('transpiles discriminated union with complex fields', () => {
    const result = transpile(`
      interface Reading { value: number; unit: string }
      type Event = 
        | { type: "reading"; data: Reading }
        | { type: "alert"; message: string };
      function handleEvent(event: Event): string {
        return event.type;
      }
    `);
    expectCppContains(result, ['std::variant<_Event_Variant_0, _Event_Variant_1>']);
    expectCppContains(result, ['struct _Event_Variant_0']);
    expectCppContains(result, ['data']);
  });
});

describe('export default', () => {
  it('export default does not cause errors', () => {
    const result = transpile(`
      function main(): void { }
      export default main;
    `);
    expectCppContains(result, ['void main()']);
  });

  it('export default class does not prevent class emission', () => {
    const result = transpile(`
      class Handler {
        public run(): void { }
      }
      export default Handler;
      function test(): void {
        const h = new Handler();
        h.run();
      }
    `);
    expectCppContains(result, ['class Handler', 'void run()']);
  });

  it('import with default import syntax parses without error', () => {
    // This tests that the import parser handles the default import syntax.
    // The actual module resolution would fail, but parsing should succeed.
    const result = transpile(`
      import myFunc from "./nonexistent";
      function test(): void { }
    `);
    // Should not crash — the import is recorded but module is skipped
    expect(result.diagnostics.filter(d => d.code === 'TS2CPP_UNSUPPORTED_TOPLEVEL')).toHaveLength(0);
  });
});
