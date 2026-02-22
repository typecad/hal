import { describe, it, expect } from "vitest";
import { transpile, normalizeCpp, hasInclude } from "./setup";

describe("Expression Transpilation", () => {
  describe("Number Literals", () => {
    it("transpiles integer literals", () => {
      const result = transpile(`
        function test(): int {
          const x = 42;
          return x;
        }
      `);
      expect(result.cpp).toContain("const int x = 42");
    });

    it("transpiles negative integers", () => {
      const result = transpile(`
        function test(): int {
          const x = -17;
          return x;
        }
      `);
      // Negative numbers are supported
      expect(result.cpp).toContain("-17");
    });

    it("transpiles floating point numbers", () => {
      const result = transpile(`
        function test(): float {
          const x = 3.14;
          return x;
        }
      `);
      expect(result.cpp).toContain("const float x = 3.14");
    });

    it("transpiles negative floats", () => {
      const result = transpile(`
        function test(): float {
          const x = -2.718;
          return x;
        }
      `);
      // Floats may have 'f' suffix
      expect(result.cpp).toContain("-2.718");
    });

    it("transpiles number used in expression", () => {
      const result = transpile(`
        function test(): int {
          let sum = 10 + 20;
          return sum;
        }
      `);
      expect(result.cpp).toContain("int sum = 10 + 20");
    });

    it("transpiles number passed as argument", () => {
      const result = transpile(`
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          return add(5, 10);
        }
      `);
      expect(result.cpp).toContain("add(5, 10)");
    });
  });

  describe("String Literals", () => {
    it("transpiles simple string literals", () => {
      const result = transpile(`
        function test(): void {
          const msg = "hello";
        }
      `);
      expect(result.cpp).toContain('const std::string msg = "hello"');
    });

    it("transpiles string with escaped quotes", () => {
      const result = transpile(`
        function test(): void {
          const msg = "say \\"hello\\"";
        }
      `);
      // Escaped quotes are preserved in output
      expect(result.cpp).toContain('const std::string msg = "say \\"hello\\""');
    });

    it("transpiles empty string", () => {
      const result = transpile(`
        function test(): void {
          const msg = "";
        }
      `);
      expect(result.cpp).toContain('const std::string msg = ""');
    });

    it("transpiles string in variable assignment", () => {
      const result = transpile(`
        function test(): void {
          let message = "initial";
          message = "updated";
        }
      `);
      expect(result.cpp).toContain('std::string message = "initial"');
      expect(result.cpp).toContain('message = "updated"');
    });
  });

  describe("Boolean Literals", () => {
    it("transpiles true literal", () => {
      const result = transpile(`
        function test(): bool {
          const flag = true;
          return flag;
        }
      `);
      expect(result.cpp).toContain("const bool flag = true");
    });

    it("transpiles false literal", () => {
      const result = transpile(`
        function test(): bool {
          const flag = false;
          return flag;
        }
      `);
      expect(result.cpp).toContain("const bool flag = false");
    });

    it("transpiles boolean in expression context", () => {
      const result = transpile(`
        function test(): bool {
          const enabled = true;
          const disabled = false;
          return enabled && !disabled;
        }
      `);
      expect(result.cpp).toContain("const bool enabled = true");
      expect(result.cpp).toContain("const bool disabled = false");
    });
  });

  describe("Identifiers", () => {
    it("transpiles identifier references", () => {
      const result = transpile(`
        function test(): int {
          const x = 10;
          const y = x;
          return y;
        }
      `);
      expect(result.cpp).toContain("const int x = 10");
      expect(result.cpp).toContain("const int y = x");
    });

    it("transpiles identifiers in expressions", () => {
      const result = transpile(`
        function test(): int {
          const a = 5;
          const b = 10;
          const c = a + b;
          return c;
        }
      `);
      expect(result.cpp).toContain("const int c = a + b");
    });

    it("transpiles function call as expression", () => {
      const result = transpile(`
        function getValue(): int {
          return 42;
        }
        function test(): int {
          const val = getValue();
          return val;
        }
      `);
      // Function call results use auto type inference
      expect(result.cpp).toContain("getValue()");
    });
  });

  describe("Ternary Expressions", () => {
    it("transpiles simple ternary expression", () => {
      const result = transpile(`
        function test(flag: bool): int {
          const value = flag ? 1 : 0;
          return value;
        }
      `);
      // Ternary uses auto type inference
      expect(result.cpp).toContain("const auto value = (flag ? 1 : 0)");
    });

    it("transpiles ternary with variable operands", () => {
      const result = transpile(`
        function test(flag: bool): int {
          const a = 10;
          const b = 20;
          const result = flag ? a : b;
          return result;
        }
      `);
      // Ternary uses auto type inference
      expect(result.cpp).toContain("const auto result = (flag ? a : b)");
    });

    it("transpiles nested ternary expressions", () => {
      const result = transpile(`
        function test(x: int): int {
          const value = x > 0 ? 1 : (x < 0 ? -1 : 0);
          return value;
        }
      `);
      expect(result.cpp).toContain("? 1 :");
      expect(result.cpp).toContain("? -1 : 0");
    });

    it("transpiles ternary in return statement", () => {
      const result = transpile(`
        function test(flag: bool): int {
          return flag ? 100 : 200;
        }
      `);
      expect(result.cpp).toContain("return (flag ? 100 : 200)");
    });
  });

  describe("Array Literals", () => {
    it("transpiles empty array", () => {
      const result = transpile(`
        function test(): void {
          const arr: int[] = [];
        }
      `);
      expect(result.cpp).toContain("const std::vector<int> arr = {");
    });

    it("transpiles array with number elements", () => {
      const result = transpile(`
        function test(): void {
          const arr = [1, 2, 3, 4, 5];
        }
      `);
      expect(result.cpp).toContain("const std::vector<int> arr = { 1, 2, 3, 4, 5 }");
    });

    it("transpiles array with variable elements", () => {
      const result = transpile(`
        function test(): void {
          const a = 1;
          const b = 2;
          const arr = [a, b];
        }
      `);
      expect(result.cpp).toContain("const std::vector<int> arr = { a, b }");
    });

    it("transpiles array with mixed literals and variables", () => {
      const result = transpile(`
        function test(): void {
          const x = 10;
          const arr = [0, x, 20];
        }
      `);
      expect(result.cpp).toContain("const std::vector<int> arr = { 0, x, 20 }");
    });

    it("emits vector stream helper when logging arrays", () => {
      const result = transpile(`
        function test(): void {
          const arr = [1, 2, 3];
          console.log(arr);
        }
      `);
      expect(result.cpp).toContain("template <typename T>");
      expect(result.cpp).toContain("operator<<(std::ostream& os, const std::vector<T>& values)");
      expect(result.cpp).toContain("std::cout << arr << std::endl");
    });
  });

  describe("Object Literals", () => {
    it("transpiles simple object literal", () => {
      const result = transpile(`
        function test(): void {
          const obj = { x: 1, y: 2 };
        }
      `);
      expect(result.cpp).toContain("struct _obj_t");
      expect(result.cpp).toContain("obj = { 1, 2 }");
    });

    it("transpiles object with various field types", () => {
      const result = transpile(`
        function test(): void {
          const obj = { name: "test", count: 42, active: true };
        }
      `);
      expect(result.cpp).toContain("obj = { \"test\", 42, true }");
    });

    it("transpiles object with variable field values", () => {
      const result = transpile(`
        function test(): void {
          const val = 100;
          const obj = { value: val };
        }
      `);
      expect(result.cpp).toContain("obj = { val }");
    });
  });

  describe("Binary Expressions", () => {
    it("transpiles addition", () => {
      const result = transpile(`
        function test(): int {
          const sum = 5 + 3;
          return sum;
        }
      `);
      expect(result.cpp).toContain("const int sum = 5 + 3");
    });

    it("transpiles subtraction", () => {
      const result = transpile(`
        function test(): int {
          const diff = 10 - 4;
          return diff;
        }
      `);
      expect(result.cpp).toContain("const int diff = 10 - 4");
    });

    it("transpiles multiplication", () => {
      const result = transpile(`
        function test(): int {
          const product = 6 * 7;
          return product;
        }
      `);
      expect(result.cpp).toContain("const int product = 6 * 7");
    });

    it("transpiles division", () => {
      const result = transpile(`
        function test(): int {
          const quotient = 20 / 4;
          return quotient;
        }
      `);
      expect(result.cpp).toContain("const int quotient = 20 / 4");
    });

    it("transpiles modulo", () => {
      const result = transpile(`
        function test(): int {
          const remainder = 17 % 5;
          return remainder;
        }
      `);
      expect(result.cpp).toContain("const int remainder = 17 % 5");
    });

    it("transpiles comparison operators", () => {
      const result = transpile(`
        function test(): bool {
          const a = 5 > 3;
          const b = 5 < 3;
          const c = 5 >= 5;
          const d = 5 <= 4;
          const e = 5 == 5;
          const f = 5 != 3;
          return a && b && c && d && e && f;
        }
      `);
      expect(result.cpp).toContain("const bool a = 5 > 3");
      expect(result.cpp).toContain("const bool b = 5 < 3");
      expect(result.cpp).toContain("const bool c = 5 >= 5");
      expect(result.cpp).toContain("const bool d = 5 <= 4");
    });

    it("transpiles logical operators", () => {
      const result = transpile(`
        function test(): bool {
          const a = true && false;
          const b = true || false;
          const c = !true;
          return a || b || c;
        }
      `);
      expect(result.cpp).toContain("const bool a = true && false");
      expect(result.cpp).toContain("const bool b = true || false");
      // Logical not uses auto type inference
      expect(result.cpp).toContain("const auto c = !true");
    });

    it("transpiles bitwise operators", () => {
      const result = transpile(`
        function test(): int {
          const a = 5 & 3;
          const b = 5 | 3;
          const c = 5 ^ 3;
          const d = 5 << 1;
          const e = 5 >> 1;
          return a + b + c + d + e;
        }
      `);
      expect(result.cpp).toContain("const int a = 5 & 3");
      expect(result.cpp).toContain("const int b = 5 | 3");
      expect(result.cpp).toContain("const int c = 5 ^ 3");
    });
  });
});