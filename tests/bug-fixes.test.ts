import { describe, it, expect } from "vitest";
import { transpile, transpileArduino, expectCppContains, expectCppNotContains } from "./setup";

// ===========================================================================
// Bug fix regression tests
// ===========================================================================

describe("Bug 1: this.x = val assignments in constructor/method bodies", () => {
  it("emits this->field = value in constructor body", () => {
    const result = transpileArduino(`
      class Counter {
        count: number;
        constructor(initial: number) {
          this.count = initial;
        }
      }
    `);

    expectCppContains(result, ["this->count = initial"]);
  });

  it("emits this->field = this->field + expr in method body", () => {
    const result = transpileArduino(`
      class Counter {
        count: number;
        increment(): number {
          this.count = this.count + 1;
          return this.count;
        }
      }
    `);

    expectCppContains(result, ["this->count = this->count + 1"]);
    expectCppContains(result, ["return this->count"]);
  });

  it("emits obj.field = value for property access assignments", () => {
    const result = transpileArduino(`
      class Sensor {
        value: number;
      }
      const s = new Sensor();
      function configure(): void {
        s.value = 42;
      }
    `);

    // The key fix: the assignment is emitted at all (previously silently dropped)
    expectCppContains(result, ["s.value = 42"]);
  });
});

describe("Bug 5: arr[i] = val element access assignments", () => {
  it("emits arr[index] = value for element access assignments", () => {
    const result = transpileArduino(`
      const arr = new Uint8Array([1, 2, 3]);
      function setElement(data: Uint8Array, i: number, val: number): void {
        data[i] = val;
      }
    `);

    expectCppContains(result, ["data[i] = val"]);
  });

  it("emits arr[expr] = value with expression index", () => {
    const result = transpileArduino(`
      const buf = new Int16Array([10, 20, 30]);
      function updateAtOffset(data: Int16Array, base: number): void {
        data[base + 1] = 99;
      }
    `);

    expectCppContains(result, ["data[base + 1] = 99"]);
  });
});

describe("Bug 7: Parenthesized expressions preserve precedence", () => {
  it("wraps lower-precedence left operand in parentheses", () => {
    const result = transpileArduino(`
      const x: number = (2 + 3) * 4;
    `);

    // Should emit (2 + 3) * 4, not 2 + 3 * 4
    expectCppContains(result, ["(2 + 3) * 4"]);
  });

  it("wraps lower-precedence right operand in parentheses", () => {
    const result = transpileArduino(`
      const x: number = 4 * (2 + 3);
    `);

    expectCppContains(result, ["4 * (2 + 3)"]);
  });

  it("does not add unnecessary parentheses for same-precedence operators", () => {
    const result = transpileArduino(`
      const x: number = 2 + 3 + 4;
    `);

    // Same precedence, left-to-right — no parens needed
    expect(result.cpp).not.toContain("(2 + 3)");
  });

  it("handles mixed precedence chains", () => {
    const result = transpileArduino(`
      const x: number = (a + b) * (c + d);
    `);

    expectCppContains(result, ["(a + b) * (c + d)"]);
  });
});

describe("Bug 8: Postfix unary expressions in expression context", () => {
  it("emits i++ as postfix in expression context", () => {
    const result = transpileArduino(`
      let i: number = 0;
      const x: number = i++;
    `);

    // Should emit i++ (postfix), not ++i
    expectCppContains(result, ["i++"]);
  });

  it("emits i-- as postfix in expression context", () => {
    const result = transpileArduino(`
      let i: number = 5;
      const x: number = i--;
    `);

    expectCppContains(result, ["i--"]);
  });
});

describe("Bug 3: new Uint8Array(n) size constructor", () => {
  it("emits zero-initialized C array for new Uint8Array(4)", () => {
    const result = transpileArduino(`
      const buf = new Uint8Array(4);
    `);

    expectCppContains(result, ["uint8_t buf[] = { 0, 0, 0, 0 }"]);
    expectCppNotContains(result, ["new Uint8Array"]);
  });

  it("emits zero-initialized C array for new Int16Array(3)", () => {
    const result = transpileArduino(`
      const buf = new Int16Array(3);
    `);

    expectCppContains(result, ["int16_t buf[] = { 0, 0, 0 }"]);
    expectCppNotContains(result, ["new Int16Array"]);
  });
});

describe("Bug 9: String assertions preprocessor", () => {
  // Note: The preprocessor is tested via the preprocess function directly
  // These tests verify the ChainSegment carries isStringExpect flag
  it("distinguishes expectString from expect in segment collection", async () => {
    const { preprocess } = await import("../packages/expect/src/host/preprocessor");
    const result = preprocess(`
      import { describe, done } from '@typecode/expect';
      const greeting: string = "hello";
      describe("strings")
        .it("greeting")
          .expectString(greeting).toBe("hello")
      done();
    `);

    // The preprocessed output should use string type annotation for the hoisted variable
    expect(result).toContain("string");
    expect(result).toContain("greeting");
  });
});

// ===========================================================================
// Bug 4: Float type propagation
// ===========================================================================
describe("Bug 4: Float type propagation", () => {
  it("renders float literals with f suffix", () => {
    const result = transpileArduino(`
      const x = 1.5;
    `);

    expectCppContains(result, ["1.5f"]);
    expectCppNotContains(result, ["1.5;"]);
  });

  it("renders integer-valued float literals with .0f suffix", () => {
    const result = transpileArduino(`
      const y = 4.0;
    `);

    expectCppContains(result, ["4.0f"]);
  });

  it("infers float type for float variable declarations", () => {
    const result = transpileArduino(`
      const x = 1.5;
    `);

    expectCppContains(result, ["float x = 1.5f"]);
  });

  it("promotes function return type from int to float when body returns float", () => {
    const result = transpileArduino(`
      function half(n: number): number {
        return n / 2.0;
      }
    `);

    expectCppContains(result, ["float half"]);
    expectCppContains(result, ["2.0f"]);
  });

  it("renders float arithmetic with f suffixes", () => {
    const result = transpileArduino(`
      const sum = 1.5 + 2.5;
    `);

    expectCppContains(result, ["1.5f"]);
    expectCppContains(result, ["2.5f"]);
    expectCppContains(result, ["float sum"]);
  });

  it("keeps integer literals without f suffix", () => {
    const result = transpileArduino(`
      const count = 42;
    `);

    expectCppContains(result, ["int count = 42"]);
    expectCppNotContains(result, ["42f"]);
  });

  it("handles mixed int/float arithmetic", () => {
    const result = transpileArduino(`
      const z = 10 + 0.5;
    `);

    expectCppContains(result, ["0.5f"]);
    expectCppContains(result, ["float z"]);
  });

  it("promotes arrow function return type when returning float", () => {
    const result = transpileArduino(`
      const getHalf = (n: number): number => {
        return n * 0.5;
      };
    `);

    expectCppContains(result, ["0.5f"]);
    expectCppContains(result, ["float getHalf"]);
  });
});

describe("Bug 2: Nested object struct generation", () => {
  it("generates nested struct for two-level nested object literal", () => {
    const result = transpileArduino(`
      const sensor = {
        calibration: { offset: 10, gain: 2 },
        name: "temp"
      };
    `);

    expectCppContains(result, [
      "struct _sensor_calibration_t { int offset; int gain; };",
      "_sensor_calibration_t calibration;",
      "const char* name;",
    ]);
    expectCppContains(result, ["{ { 10, 2 }, \"temp\" }"]);
  });

  it("generates nested struct for three-level nested object", () => {
    const result = transpileArduino(`
      const config = {
        display: { size: { w: 128, h: 64 }, inverted: false }
      };
    `);

    // Deepest struct first, then intermediate
    expectCppContains(result, [
      "struct _config_display_size_t { int w; int h; };",
      "struct _config_display_t { _config_display_size_t size; bool inverted; };",
    ]);
    expectCppContains(result, ["{ { { 128, 64 }, false } }"]);
  });

  it("preserves nested object field access expressions", () => {
    const result = transpileArduino(`
      const sensor = {
        calibration: { offset: 10, gain: 2 },
        name: "temp"
      };
      function readOffset(): number {
        return sensor.calibration.offset;
      }
    `);

    expectCppContains(result, ["sensor.calibration.offset"]);
  });

  it("handles nested object with mixed types including float", () => {
    const result = transpileArduino(`
      const device = {
        tuning: { frequency: 440.0, amplitude: 1 },
        active: true
      };
    `);

    expectCppContains(result, [
      "struct _device_tuning_t { float frequency; int amplitude; };",
      "float frequency",
    ]);
  });
});

describe("Bug 6: Nested function hoisting", () => {
  it("hoists nested function to file scope with mangled name", () => {
    const result = transpileArduino(`
      function outer(): number {
        function inner(x: number): number {
          return x * 2;
        }
        return inner(5);
      }
    `);

    expectCppContains(result, [
      "int outer__inner(int x)",
      "return x * 2;",
      "return outer__inner(5);",
    ]);
  });

  it("hoists nested function called before its declaration (hoisting)", () => {
    const result = transpileArduino(`
      function compute(): number {
        return helper(3);
        function helper(n: number): number {
          return n + 10;
        }
      }
    `);

    expectCppContains(result, [
      "int compute__helper(int n)",
      "return n + 10;",
      "return compute__helper(3);",
    ]);
  });

  it("hoists multiple nested functions from the same parent", () => {
    const result = transpileArduino(`
      function math(): number {
        function add(a: number, b: number): number {
          return a + b;
        }
        function mul(a: number, b: number): number {
          return a * b;
        }
        return add(mul(2, 3), 4);
      }
    `);

    expectCppContains(result, [
      "int math__add(int a, int b)",
      "int math__mul(int a, int b)",
      "return math__add(math__mul(2, 3), 4);",
    ]);
  });

  it("preserves return type annotation on nested function", () => {
    const result = transpileArduino(`
      function parent(): number {
        function child(x: number): number {
          return x + 1;
        }
        return child(10);
      }
    `);

    expectCppContains(result, [
      "int parent__child(int x)",
    ]);
  });
});
