import { describe, it, expect } from "vitest";
import { transpile, normalizeCpp } from "./setup";

describe("Statement Transpilation", () => {
  describe("Variable Declarations", () => {
    it("transpiles var declaration", () => {
      const result = transpile(`
        function test(): void {
          var x = 10;
        }
      `);
      expect(result.cpp).toContain("int x = 10");
    });

    it("transpiles let declaration", () => {
      const result = transpile(`
        function test(): void {
          let x = 10;
        }
      `);
      expect(result.cpp).toContain("int x = 10");
    });

    it("transpiles const declaration", () => {
      const result = transpile(`
        function test(): void {
          const x = 10;
        }
      `);
      expect(result.cpp).toContain("const int x = 10");
    });

    it("transpiles declaration without initializer", () => {
      const result = transpile(`
        function test(): void {
          let x: int;
        }
      `);
      // Without initializer, uses explicit type annotation
      expect(result.cpp).toContain("int x");
    });

    it("transpiles declaration with typed initializer", () => {
      const result = transpile(`
        function test(): void {
          const x: int = 42;
        }
      `);
      expect(result.cpp).toContain("const int x = 42");
    });

    it("transpiles float declaration", () => {
      const result = transpile(`
        function test(): void {
          const pi: float = 3.14159;
        }
      `);
      expect(result.cpp).toContain("const float pi = 3.14159");
    });

    it("transpiles bool declaration", () => {
      const result = transpile(`
        function test(): void {
          const flag: bool = true;
        }
      `);
      expect(result.cpp).toContain("const bool flag = true");
    });

    it("transpiles multiple declarations", () => {
      const result = transpile(`
        function test(): void {
          const a = 1;
          const b = 2;
          const c = 3;
        }
      `);
      expect(result.cpp).toContain("const int a = 1");
      expect(result.cpp).toContain("const int b = 2");
      expect(result.cpp).toContain("const int c = 3");
    });
  });

  describe("Assignments", () => {
    it("transpiles simple assignment", () => {
      const result = transpile(`
        function test(): void {
          let x = 10;
          x = 20;
        }
      `);
      expect(result.cpp).toContain("x = 20");
    });

    it("transpiles addition assignment (+=)", () => {
      const result = transpile(`
        function test(): void {
          let x = 10;
          x += 5;
        }
      `);
      expect(result.cpp).toContain("x += 5");
    });

    it("transpiles subtraction assignment (-=)", () => {
      const result = transpile(`
        function test(): void {
          let x = 10;
          x -= 3;
        }
      `);
      expect(result.cpp).toContain("x -= 3");
    });

    it("transpiles multiplication assignment (*=)", () => {
      const result = transpile(`
        function test(): void {
          let x = 10;
          x *= 2;
        }
      `);
      expect(result.cpp).toContain("x *= 2");
    });

    it("transpiles division assignment (/=)", () => {
      const result = transpile(`
        function test(): void {
          let x = 10;
          x /= 2;
        }
      `);
      expect(result.cpp).toContain("x /= 2");
    });

    it("transpiles modulo assignment (%=)", () => {
      const result = transpile(`
        function test(): void {
          let x = 10;
          x %= 3;
        }
      `);
      expect(result.cpp).toContain("x %= 3");
    });

    it("transpiles bitwise AND assignment (&=)", () => {
      const result = transpile(`
        function test(): void {
          let x = 15;
          x &= 7;
        }
      `);
      expect(result.cpp).toContain("x &= 7");
    });

    it("transpiles bitwise OR assignment (|=)", () => {
      const result = transpile(`
        function test(): void {
          let x = 8;
          x |= 3;
        }
      `);
      expect(result.cpp).toContain("x |= 3");
    });

    it("transpiles bitwise XOR assignment (^=)", () => {
      const result = transpile(`
        function test(): void {
          let x = 15;
          x ^= 7;
        }
      `);
      expect(result.cpp).toContain("x ^= 7");
    });

    it("transpiles left shift assignment (<<=)", () => {
      const result = transpile(`
        function test(): void {
          let x = 1;
          x <<= 4;
        }
      `);
      expect(result.cpp).toContain("x <<= 4");
    });

    it("transpiles right shift assignment (>>=)", () => {
      const result = transpile(`
        function test(): void {
          let x = 16;
          x >>= 2;
        }
      `);
      expect(result.cpp).toContain("x >>= 2");
    });

    it("transpiles assignment with variable value", () => {
      const result = transpile(`
        function test(): void {
          let x = 10;
          const y = 5;
          x = y;
        }
      `);
      expect(result.cpp).toContain("x = y");
    });

    it("transpiles assignment with expression value", () => {
      const result = transpile(`
        function test(): void {
          let x = 10;
          const y = 5;
          x = y * 2 + 1;
        }
      `);
      expect(result.cpp).toContain("x = y * 2 + 1");
    });
  });

  describe("Update Expressions", () => {
    it("transpiles postfix increment", () => {
      const result = transpile(`
        function test(): int {
          let x = 10;
          x++;
          return x;
        }
      `);
      expect(result.cpp).toContain("x++");
    });

    it("transpiles prefix increment", () => {
      const result = transpile(`
        function test(): int {
          let x = 10;
          ++x;
          return x;
        }
      `);
      expect(result.cpp).toContain("++x");
    });

    it("transpiles postfix decrement", () => {
      const result = transpile(`
        function test(): int {
          let x = 10;
          x--;
          return x;
        }
      `);
      expect(result.cpp).toContain("x--");
    });

    it("transpiles prefix decrement", () => {
      const result = transpile(`
        function test(): int {
          let x = 10;
          --x;
          return x;
        }
      `);
      expect(result.cpp).toContain("--x");
    });

    it("transpiles increment in for loop", () => {
      const result = transpile(`
        function test(): int {
          let sum = 0;
          for (let i = 0; i < 10; i++) {
            sum += i;
          }
          return sum;
        }
      `);
      expect(result.cpp).toContain("i++");
    });

    it("transpiles decrement in for loop", () => {
      const result = transpile(`
        function test(): int {
          let sum = 0;
          for (let i = 10; i > 0; i--) {
            sum += i;
          }
          return sum;
        }
      `);
      expect(result.cpp).toContain("i--");
    });
  });

  describe("Return Statements", () => {
    it("transpiles return without value", () => {
      const result = transpile(`
        function test(): void {
          return;
        }
      `);
      expect(result.cpp).toContain("return;");
    });

    it("transpiles return with number literal", () => {
      const result = transpile(`
        function test(): int {
          return 42;
        }
      `);
      expect(result.cpp).toContain("return 42");
    });

    it("transpiles return with string literal", () => {
      const result = transpile(`
        function getMessage(): string {
          return "hello";
        }
      `);
      expect(result.cpp).toContain('return "hello"');
    });

    it("transpiles return with boolean literal", () => {
      const result = transpile(`
        function test(): bool {
          return true;
        }
      `);
      expect(result.cpp).toContain("return true");
    });

    it("transpiles return with variable", () => {
      const result = transpile(`
        function test(): int {
          const x = 42;
          return x;
        }
      `);
      expect(result.cpp).toContain("return x");
    });

    it("transpiles return with expression", () => {
      const result = transpile(`
        function add(a: int, b: int): int {
          return a + b;
        }
      `);
      expect(result.cpp).toContain("return a + b");
    });

    it("transpiles return with function call", () => {
      const result = transpile(`
        function getValue(): int {
          return 42;
        }
        function test(): int {
          return getValue();
        }
      `);
      expect(result.cpp).toContain("return getValue()");
    });

    it("transpiles conditional return", () => {
      const result = transpile(`
        function test(flag: bool): int {
          if (flag) {
            return 1;
          }
          return 0;
        }
      `);
      expect(result.cpp).toContain("return 1");
      expect(result.cpp).toContain("return 0");
    });
  });

  describe("Expression Statements", () => {
    it("transpiles function call as statement", () => {
      const result = transpile(`
        function doSomething(): void {
          const x = 1;
        }
        function test(): void {
          doSomething();
        }
      `);
      expect(result.cpp).toContain("doSomething()");
    });

    it("transpiles method call as statement", () => {
      const result = transpile(`
        function test(): void {
          console.log("hello");
        }
      `);
      expect(result.cpp).toContain("std::cout");
    });

    it("transpiles nested function call", () => {
      const result = transpile(`
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
      expect(result.cpp).toContain("outer(inner())");
    });
  });

  describe("Break and Continue", () => {
    it("transpiles break in for loop", () => {
      const result = transpile(`
        function test(): int {
          for (let i = 0; i < 10; i++) {
            if (i == 5) {
              break;
            }
          }
          return 0;
        }
      `);
      expect(result.cpp).toContain("break;");
    });

    it("transpiles continue in for loop", () => {
      const result = transpile(`
        function test(): int {
          for (let i = 0; i < 10; i++) {
            if (i == 5) {
              continue;
            }
          }
          return 0;
        }
      `);
      expect(result.cpp).toContain("continue;");
    });

    it("transpiles break in while loop", () => {
      const result = transpile(`
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
      expect(result.cpp).toContain("break;");
    });

    it("transpiles continue in while loop", () => {
      const result = transpile(`
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
      expect(result.cpp).toContain("continue;");
    });

    it("transpiles break in switch", () => {
      const result = transpile(`
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
      expect(result.cpp).toContain("break;");
    });
  });

  describe("Throw and Try-Catch", () => {
    it("transpiles throw statement", () => {
      const result = transpile(`
        function test(): void {
          throw "error";
        }
      `);
      expect(result.cpp).toContain('throw "error"');
    });

    it("transpiles try-catch block", () => {
      const result = transpile(`
        function test(): void {
          try {
            const x = 1;
          } catch (e) {
            const y = 2;
          }
        }
      `);
      expect(result.cpp).toContain("try");
      expect(result.cpp).toContain("catch");
    });

    it("transpiles try-catch with statements", () => {
      const result = transpile(`
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
      expect(result.cpp).toContain("try");
      expect(result.cpp).toContain("catch");
      expect(result.cpp).toContain("result = risky()");
    });
  });
});