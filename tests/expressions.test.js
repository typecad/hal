"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const setup_1 = require("./setup");
(0, vitest_1.describe)("Expression Transpilation", () => {
    (0, vitest_1.describe)("Number Literals", () => {
        (0, vitest_1.it)("transpiles integer literals", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          const x = 42;
          return x;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int x = 42");
        });
        (0, vitest_1.it)("transpiles negative integers", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          const x = -17;
          return x;
        }
      `);
            // Negative numbers are supported
            (0, vitest_1.expect)(result.cpp).toContain("-17");
        });
        (0, vitest_1.it)("transpiles floating point numbers", () => {
            const result = (0, setup_1.transpile)(`
        function test(): float {
          const x = 3.14;
          return x;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const float x = 3.14");
        });
        (0, vitest_1.it)("transpiles negative floats", () => {
            const result = (0, setup_1.transpile)(`
        function test(): float {
          const x = -2.718;
          return x;
        }
      `);
            // Floats may have 'f' suffix
            (0, vitest_1.expect)(result.cpp).toContain("-2.718");
        });
        (0, vitest_1.it)("transpiles number used in expression", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let sum = 10 + 20;
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("int sum = 10 + 20");
        });
        (0, vitest_1.it)("transpiles number passed as argument", () => {
            const result = (0, setup_1.transpile)(`
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          return add(5, 10);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("add(5, 10)");
        });
    });
    (0, vitest_1.describe)("String Literals", () => {
        (0, vitest_1.it)("transpiles simple string literals", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const msg = "hello";
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain('const std::string msg = "hello"');
        });
        (0, vitest_1.it)("transpiles string with escaped quotes", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const msg = "say \\"hello\\"";
        }
      `);
            // Escaped quotes are preserved in output
            (0, vitest_1.expect)(result.cpp).toContain('const std::string msg = "say \\"hello\\""');
        });
        (0, vitest_1.it)("transpiles empty string", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const msg = "";
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain('const std::string msg = ""');
        });
        (0, vitest_1.it)("transpiles string in variable assignment", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let message = "initial";
          message = "updated";
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain('std::string message = "initial"');
            (0, vitest_1.expect)(result.cpp).toContain('message = "updated"');
        });
    });
    (0, vitest_1.describe)("Boolean Literals", () => {
        (0, vitest_1.it)("transpiles true literal", () => {
            const result = (0, setup_1.transpile)(`
        function test(): bool {
          const flag = true;
          return flag;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const bool flag = true");
        });
        (0, vitest_1.it)("transpiles false literal", () => {
            const result = (0, setup_1.transpile)(`
        function test(): bool {
          const flag = false;
          return flag;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const bool flag = false");
        });
        (0, vitest_1.it)("transpiles boolean in expression context", () => {
            const result = (0, setup_1.transpile)(`
        function test(): bool {
          const enabled = true;
          const disabled = false;
          return enabled && !disabled;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const bool enabled = true");
            (0, vitest_1.expect)(result.cpp).toContain("const bool disabled = false");
        });
    });
    (0, vitest_1.describe)("Identifiers", () => {
        (0, vitest_1.it)("transpiles identifier references", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          const x = 10;
          const y = x;
          return y;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int x = 10");
            (0, vitest_1.expect)(result.cpp).toContain("const int y = x");
        });
        (0, vitest_1.it)("transpiles identifiers in expressions", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          const a = 5;
          const b = 10;
          const c = a + b;
          return c;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int c = a + b");
        });
        (0, vitest_1.it)("transpiles function call as expression", () => {
            const result = (0, setup_1.transpile)(`
        function getValue(): int {
          return 42;
        }
        function test(): int {
          const val = getValue();
          return val;
        }
      `);
            // Function call results use auto type inference
            (0, vitest_1.expect)(result.cpp).toContain("getValue()");
        });
    });
    (0, vitest_1.describe)("Ternary Expressions", () => {
        (0, vitest_1.it)("transpiles simple ternary expression", () => {
            const result = (0, setup_1.transpile)(`
        function test(flag: bool): int {
          const value = flag ? 1 : 0;
          return value;
        }
      `);
            // Ternary uses explicit type inference from operands
            (0, vitest_1.expect)(result.cpp).toContain("const int value = (flag ? 1 : 0)");
        });
        (0, vitest_1.it)("transpiles ternary with variable operands", () => {
            const result = (0, setup_1.transpile)(`
        function test(flag: bool): int {
          const a = 10;
          const b = 20;
          const result = flag ? a : b;
          return result;
        }
      `);
            // Ternary uses explicit type inference from operands
            (0, vitest_1.expect)(result.cpp).toContain("const int result = (flag ? a : b)");
        });
        (0, vitest_1.it)("transpiles nested ternary expressions", () => {
            const result = (0, setup_1.transpile)(`
        function test(x: int): int {
          const value = x > 0 ? 1 : (x < 0 ? -1 : 0);
          return value;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("? 1 :");
            (0, vitest_1.expect)(result.cpp).toContain("? -1 : 0");
        });
        (0, vitest_1.it)("transpiles ternary in return statement", () => {
            const result = (0, setup_1.transpile)(`
        function test(flag: bool): int {
          return flag ? 100 : 200;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("return (flag ? 100 : 200)");
        });
    });
    (0, vitest_1.describe)("Array Literals", () => {
        (0, vitest_1.it)("transpiles empty array", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const arr: int[] = [];
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const std::vector<int> arr = {");
        });
        (0, vitest_1.it)("transpiles array with number elements", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const arr = [1, 2, 3, 4, 5];
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const std::vector<int> arr = { 1, 2, 3, 4, 5 }");
        });
        (0, vitest_1.it)("transpiles array with variable elements", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const a = 1;
          const b = 2;
          const arr = [a, b];
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const std::vector<int> arr = { a, b }");
        });
        (0, vitest_1.it)("transpiles array with mixed literals and variables", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const x = 10;
          const arr = [0, x, 20];
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const std::vector<int> arr = { 0, x, 20 }");
        });
        (0, vitest_1.it)("emits vector stream helper when logging arrays", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const arr = [1, 2, 3];
          console.log(arr);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("template <typename T>");
            (0, vitest_1.expect)(result.cpp).toContain("operator<<(std::ostream& os, const std::vector<T>& values)");
            (0, vitest_1.expect)(result.cpp).toContain("std::cout << arr << std::endl");
        });
    });
    (0, vitest_1.describe)("Object Literals", () => {
        (0, vitest_1.it)("transpiles simple object literal", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const obj = { x: 1, y: 2 };
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("struct _obj_t");
            (0, vitest_1.expect)(result.cpp).toContain("obj = { 1, 2 }");
        });
        (0, vitest_1.it)("transpiles object with various field types", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const obj = { name: "test", count: 42, active: true };
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("obj = { \"test\", 42, true }");
        });
        (0, vitest_1.it)("transpiles object with variable field values", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const val = 100;
          const obj = { value: val };
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("obj = { val }");
        });
    });
    (0, vitest_1.describe)("Binary Expressions", () => {
        (0, vitest_1.it)("transpiles addition", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          const sum = 5 + 3;
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int sum = 5 + 3");
        });
        (0, vitest_1.it)("transpiles subtraction", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          const diff = 10 - 4;
          return diff;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int diff = 10 - 4");
        });
        (0, vitest_1.it)("transpiles multiplication", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          const product = 6 * 7;
          return product;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int product = 6 * 7");
        });
        (0, vitest_1.it)("transpiles division", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          const quotient = 20 / 4;
          return quotient;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int quotient = 20 / 4");
        });
        (0, vitest_1.it)("transpiles modulo", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          const remainder = 17 % 5;
          return remainder;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int remainder = 17 % 5");
        });
        (0, vitest_1.it)("transpiles comparison operators", () => {
            const result = (0, setup_1.transpile)(`
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
            (0, vitest_1.expect)(result.cpp).toContain("const bool a = 5 > 3");
            (0, vitest_1.expect)(result.cpp).toContain("const bool b = 5 < 3");
            (0, vitest_1.expect)(result.cpp).toContain("const bool c = 5 >= 5");
            (0, vitest_1.expect)(result.cpp).toContain("const bool d = 5 <= 4");
        });
        (0, vitest_1.it)("transpiles logical operators", () => {
            const result = (0, setup_1.transpile)(`
        function test(): bool {
          const a = true && false;
          const b = true || false;
          const c = !true;
          return a || b || c;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const bool a = true && false");
            (0, vitest_1.expect)(result.cpp).toContain("const bool b = true || false");
            // Logical not uses explicit type inference
            (0, vitest_1.expect)(result.cpp).toContain("const int c = !true");
        });
        (0, vitest_1.it)("transpiles bitwise operators", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          const a = 5 & 3;
          const b = 5 | 3;
          const c = 5 ^ 3;
          const d = 5 << 1;
          const e = 5 >> 1;
          return a + b + c + d + e;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int a = 5 & 3");
            (0, vitest_1.expect)(result.cpp).toContain("const int b = 5 | 3");
            (0, vitest_1.expect)(result.cpp).toContain("const int c = 5 ^ 3");
        });
    });
});
