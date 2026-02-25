"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const setup_1 = require("./setup");
(0, vitest_1.describe)("Statement Transpilation", () => {
    (0, vitest_1.describe)("Variable Declarations", () => {
        (0, vitest_1.it)("transpiles var declaration", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          var x = 10;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("int x = 10");
        });
        (0, vitest_1.it)("transpiles let declaration", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 10;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("int x = 10");
        });
        (0, vitest_1.it)("transpiles const declaration", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const x = 10;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int x = 10");
        });
        (0, vitest_1.it)("transpiles declaration without initializer", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x: int;
        }
      `);
            // Without initializer, uses explicit type annotation
            (0, vitest_1.expect)(result.cpp).toContain("int x");
        });
        (0, vitest_1.it)("transpiles declaration with typed initializer", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const x: int = 42;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int x = 42");
        });
        (0, vitest_1.it)("transpiles float declaration", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const pi: float = 3.14159;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const float pi = 3.14159");
        });
        (0, vitest_1.it)("transpiles bool declaration", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const flag: bool = true;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const bool flag = true");
        });
        (0, vitest_1.it)("transpiles multiple declarations", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const a = 1;
          const b = 2;
          const c = 3;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("const int a = 1");
            (0, vitest_1.expect)(result.cpp).toContain("const int b = 2");
            (0, vitest_1.expect)(result.cpp).toContain("const int c = 3");
        });
    });
    (0, vitest_1.describe)("Assignments", () => {
        (0, vitest_1.it)("transpiles simple assignment", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 10;
          x = 20;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x = 20");
        });
        (0, vitest_1.it)("transpiles addition assignment (+=)", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 10;
          x += 5;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x += 5");
        });
        (0, vitest_1.it)("transpiles subtraction assignment (-=)", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 10;
          x -= 3;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x -= 3");
        });
        (0, vitest_1.it)("transpiles multiplication assignment (*=)", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 10;
          x *= 2;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x *= 2");
        });
        (0, vitest_1.it)("transpiles division assignment (/=)", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 10;
          x /= 2;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x /= 2");
        });
        (0, vitest_1.it)("transpiles modulo assignment (%=)", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 10;
          x %= 3;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x %= 3");
        });
        (0, vitest_1.it)("transpiles bitwise AND assignment (&=)", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 15;
          x &= 7;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x &= 7");
        });
        (0, vitest_1.it)("transpiles bitwise OR assignment (|=)", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 8;
          x |= 3;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x |= 3");
        });
        (0, vitest_1.it)("transpiles bitwise XOR assignment (^=)", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 15;
          x ^= 7;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x ^= 7");
        });
        (0, vitest_1.it)("transpiles left shift assignment (<<=)", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 1;
          x <<= 4;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x <<= 4");
        });
        (0, vitest_1.it)("transpiles right shift assignment (>>=)", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 16;
          x >>= 2;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x >>= 2");
        });
        (0, vitest_1.it)("transpiles assignment with variable value", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 10;
          const y = 5;
          x = y;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x = y");
        });
        (0, vitest_1.it)("transpiles assignment with expression value", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 10;
          const y = 5;
          x = y * 2 + 1;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x = y * 2 + 1");
        });
    });
    (0, vitest_1.describe)("Update Expressions", () => {
        (0, vitest_1.it)("transpiles postfix increment", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let x = 10;
          x++;
          return x;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x++");
        });
        (0, vitest_1.it)("transpiles prefix increment", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let x = 10;
          ++x;
          return x;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("++x");
        });
        (0, vitest_1.it)("transpiles postfix decrement", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let x = 10;
          x--;
          return x;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("x--");
        });
        (0, vitest_1.it)("transpiles prefix decrement", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let x = 10;
          --x;
          return x;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("--x");
        });
        (0, vitest_1.it)("transpiles increment in for loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let sum = 0;
          for (let i = 0; i < 10; i++) {
            sum += i;
          }
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("i++");
        });
        (0, vitest_1.it)("transpiles decrement in for loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let sum = 0;
          for (let i = 10; i > 0; i--) {
            sum += i;
          }
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("i--");
        });
    });
    (0, vitest_1.describe)("Return Statements", () => {
        (0, vitest_1.it)("transpiles return without value", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          return;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("return;");
        });
        (0, vitest_1.it)("transpiles return with number literal", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          return 42;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("return 42");
        });
        (0, vitest_1.it)("transpiles return with string literal", () => {
            const result = (0, setup_1.transpile)(`
        function getMessage(): string {
          return "hello";
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain('return "hello"');
        });
        (0, vitest_1.it)("transpiles return with boolean literal", () => {
            const result = (0, setup_1.transpile)(`
        function test(): bool {
          return true;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("return true");
        });
        (0, vitest_1.it)("transpiles return with variable", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          const x = 42;
          return x;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("return x");
        });
        (0, vitest_1.it)("transpiles return with expression", () => {
            const result = (0, setup_1.transpile)(`
        function add(a: int, b: int): int {
          return a + b;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("return a + b");
        });
        (0, vitest_1.it)("transpiles return with function call", () => {
            const result = (0, setup_1.transpile)(`
        function getValue(): int {
          return 42;
        }
        function test(): int {
          return getValue();
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("return getValue()");
        });
        (0, vitest_1.it)("transpiles conditional return", () => {
            const result = (0, setup_1.transpile)(`
        function test(flag: bool): int {
          if (flag) {
            return 1;
          }
          return 0;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("return 1");
            (0, vitest_1.expect)(result.cpp).toContain("return 0");
        });
    });
    (0, vitest_1.describe)("Expression Statements", () => {
        (0, vitest_1.it)("transpiles function call as statement", () => {
            const result = (0, setup_1.transpile)(`
        function doSomething(): void {
          const x = 1;
        }
        function test(): void {
          doSomething();
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("doSomething()");
        });
        (0, vitest_1.it)("transpiles method call as statement", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log("hello");
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
        });
        (0, vitest_1.it)("transpiles nested function call", () => {
            const result = (0, setup_1.transpile)(`
        function inner(): int {
          return 42;
        }
        function outer(val: int): int {
          return val * 2;
        }
        function test(): int {
          return outer(inner());
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("outer(inner())");
        });
    });
    (0, vitest_1.describe)("Break and Continue", () => {
        (0, vitest_1.it)("transpiles break in for loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          for (let i = 0; i < 10; i++) {
            if (i == 5) {
              break;
            }
          }
          return 0;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("break;");
        });
        (0, vitest_1.it)("transpiles continue in for loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          for (let i = 0; i < 10; i++) {
            if (i == 5) {
              continue;
            }
          }
          return 0;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("continue;");
        });
        (0, vitest_1.it)("transpiles break in while loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let i = 0;
          while (true) {
            i++;
            if (i > 10) {
              break;
            }
          }
          return i;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("break;");
        });
        (0, vitest_1.it)("transpiles continue in while loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let i = 0;
          while (i < 10) {
            i++;
            if (i == 5) {
              continue;
            }
          }
          return i;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("continue;");
        });
        (0, vitest_1.it)("transpiles break in switch", () => {
            const result = (0, setup_1.transpile)(`
        function test(x: int): int {
          let result = 0;
          switch (x) {
            case 1:
              result = 10;
              break;
            case 2:
              result = 20;
              break;
          }
          return result;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("break;");
        });
    });
    (0, vitest_1.describe)("Throw and Try-Catch", () => {
        (0, vitest_1.it)("transpiles throw statement", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          throw "error";
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain('throw "error"');
        });
        (0, vitest_1.it)("transpiles try-catch block", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          try {
            const x = 1;
          } catch (e) {
            const y = 2;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("try");
            (0, vitest_1.expect)(result.cpp).toContain("catch");
        });
        (0, vitest_1.it)("transpiles try-catch with statements", () => {
            const result = (0, setup_1.transpile)(`
        function risky(): int {
          return 42;
        }
        function test(): int {
          let result = 0;
          try {
            result = risky();
          } catch (e) {
            result = -1;
          }
          return result;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("try");
            (0, vitest_1.expect)(result.cpp).toContain("catch");
            (0, vitest_1.expect)(result.cpp).toContain("result = risky()");
        });
    });
});
