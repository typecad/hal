"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const setup_1 = require("./setup");
(0, vitest_1.describe)("Control Flow Transpilation", () => {
    (0, vitest_1.describe)("If Statements", () => {
        (0, vitest_1.it)("transpiles simple if statement", () => {
            const result = (0, setup_1.transpile)(`
        function test(x: int): int {
          if (x > 0) {
            return 1;
          }
          return 0;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("if (x > 0)");
            (0, vitest_1.expect)(result.cpp).toContain("return 1");
        });
        (0, vitest_1.it)("transpiles if-else statement", () => {
            const result = (0, setup_1.transpile)(`
        function test(x: int): int {
          if (x > 0) {
            return 1;
          } else {
            return -1;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("if (x > 0)");
            (0, vitest_1.expect)(result.cpp).toContain("else");
            (0, vitest_1.expect)(result.cpp).toContain("return -1");
        });
        (0, vitest_1.it)("transpiles if-else if-else chain", () => {
            const result = (0, setup_1.transpile)(`
        function test(x: int): int {
          if (x > 10) {
            return 1;
          } else if (x > 5) {
            return 2;
          } else {
            return 3;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("if (x > 10)");
            // else if is emitted as separate else + if
            (0, vitest_1.expect)(result.cpp).toContain("else");
            (0, vitest_1.expect)(result.cpp).toContain("if (x > 5)");
        });
        (0, vitest_1.it)("transpiles nested if statements", () => {
            const result = (0, setup_1.transpile)(`
        function test(a: int, b: int): int {
          if (a > 0) {
            if (b > 0) {
              return 1;
            }
          }
          return 0;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("if (a > 0)");
            (0, vitest_1.expect)(result.cpp).toContain("if (b > 0)");
        });
        (0, vitest_1.it)("transpiles if with boolean variable condition", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const flag = true;
          if (flag) {
            const x = 1;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("if (flag)");
        });
        (0, vitest_1.it)("transpiles if with complex condition", () => {
            const result = (0, setup_1.transpile)(`
        function test(a: int, b: int): void {
          if (a > 0 && b > 0) {
            const x = 1;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("if (a > 0 && b > 0)");
        });
        (0, vitest_1.it)("transpiles if with negated condition", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const flag = true;
          if (!flag) {
            const x = 1;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("if (!flag)");
        });
    });
    (0, vitest_1.describe)("While Loops", () => {
        (0, vitest_1.it)("transpiles simple while loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let count = 0;
          while (count < 10) {
            count++;
          }
          return count;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("while (count < 10)");
            (0, vitest_1.expect)(result.cpp).toContain("count++");
        });
        (0, vitest_1.it)("transpiles while loop with break", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let i = 0;
          while (true) {
            i++;
            if (i >= 5) {
              break;
            }
          }
          return i;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("while (true)");
            (0, vitest_1.expect)(result.cpp).toContain("break");
        });
        (0, vitest_1.it)("transpiles while loop with continue", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let i = 0;
          let sum = 0;
          while (i < 10) {
            i++;
            if (i == 5) {
              continue;
            }
            sum += i;
          }
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("while (i < 10)");
            (0, vitest_1.expect)(result.cpp).toContain("continue");
        });
        (0, vitest_1.it)("transpiles nested while loops", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let i = 0;
          let j = 0;
          while (i < 3) {
            j = 0;
            while (j < 3) {
              j++;
            }
            i++;
          }
          return i + j;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("while (i < 3)");
            (0, vitest_1.expect)(result.cpp).toContain("while (j < 3)");
        });
        (0, vitest_1.it)("transpiles while with variable condition", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const limit = 10;
          let i = 0;
          while (i < limit) {
            i++;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("while (i < limit)");
        });
    });
    (0, vitest_1.describe)("Do-While Loops", () => {
        (0, vitest_1.it)("transpiles simple do-while loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let count = 0;
          do {
            count++;
          } while (count < 10);
          return count;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("do");
            (0, vitest_1.expect)(result.cpp).toContain("while (count < 10)");
        });
        (0, vitest_1.it)("transpiles do-while with variable condition", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          let x = 0;
          const max = 5;
          do {
            x++;
          } while (x < max);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("while (x < max)");
        });
        (0, vitest_1.it)("transpiles do-while with break", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let i = 0;
          do {
            i++;
            if (i > 100) {
              break;
            }
          } while (i < 10);
          return i;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("do");
            (0, vitest_1.expect)(result.cpp).toContain("break");
        });
    });
    (0, vitest_1.describe)("For Loops", () => {
        (0, vitest_1.it)("transpiles standard for loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let sum = 0;
          for (let i = 0; i < 10; i++) {
            sum += i;
          }
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("for (int i = 0; i < 10; i++)");
        });
        (0, vitest_1.it)("transpiles for loop with const variable", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          for (const x = 0; ; ) {
            break;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("for");
        });
        (0, vitest_1.it)("transpiles for loop with multiple statements", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let sum = 0;
          for (let i = 0; i < 10; i++) {
            sum += i;
            if (sum > 20) {
              break;
            }
          }
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("sum += i");
            (0, vitest_1.expect)(result.cpp).toContain("break");
        });
        (0, vitest_1.it)("transpiles infinite for loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let count = 0;
          for (;;) {
            count++;
            if (count > 10) {
              break;
            }
          }
          return count;
        }
      `);
            // Infinite for loop has spaces between semicolons
            (0, vitest_1.expect)(result.cpp).toContain("for (; ; )");
        });
        (0, vitest_1.it)("transpiles for loop with decrement", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let sum = 0;
          for (let i = 10; i > 0; i--) {
            sum += i;
          }
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("for (int i = 10; i > 0; i--)");
        });
        (0, vitest_1.it)("transpiles for loop with variable limit", () => {
            const result = (0, setup_1.transpile)(`
        function test(limit: int): int {
          let sum = 0;
          for (let i = 0; i < limit; i++) {
            sum += i;
          }
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("for (int i = 0; i < limit; i++)");
        });
    });
    (0, vitest_1.describe)("For-Of Loops", () => {
        (0, vitest_1.it)("transpiles for-of with array", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let sum = 0;
          const arr = [1, 2, 3, 4, 5];
          for (const item of arr) {
            sum += item;
          }
          return sum;
        }
      `);
            // For-of uses range-based for with explicit type inferred from array element
            (0, vitest_1.expect)(result.cpp).toContain("for (const int item : arr)");
        });
        (0, vitest_1.it)("transpiles for-of with let", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const arr = [1, 2, 3];
          for (let item of arr) {
            item = item * 2;
          }
        }
      `);
            // For-of uses range-based for with explicit type inferred from array element
            (0, vitest_1.expect)(result.cpp).toContain("for (int item : arr)");
        });
        (0, vitest_1.it)("transpiles nested for-of loops", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let sum = 0;
          const outer = [[1, 2], [3, 4]];
          for (const inner of outer) {
            for (const val of inner) {
              sum += val;
            }
          }
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("for (const");
            (0, vitest_1.expect)(result.cpp).toContain(" : inner)");
        });
    });
    (0, vitest_1.describe)("For-In Loops", () => {
        (0, vitest_1.it)("transpiles for-in loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const obj = { a: 1, b: 2 };
          for (const key in obj) {
            const val = key;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("for (");
            (0, vitest_1.expect)(result.cpp).toContain(" : obj)");
        });
    });
    (0, vitest_1.describe)("Switch Statements", () => {
        (0, vitest_1.it)("transpiles switch with cases", () => {
            const result = (0, setup_1.transpile)(`
        function test(x: int): int {
          switch (x) {
            case 1:
              return 10;
            case 2:
              return 20;
            default:
              return 0;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("switch (x)");
            (0, vitest_1.expect)(result.cpp).toContain("case 1:");
            (0, vitest_1.expect)(result.cpp).toContain("case 2:");
            (0, vitest_1.expect)(result.cpp).toContain("default:");
        });
        (0, vitest_1.it)("transpiles switch without default", () => {
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
            (0, vitest_1.expect)(result.cpp).toContain("switch (x)");
            (0, vitest_1.expect)(result.cpp).not.toContain("default:");
        });
        (0, vitest_1.it)("transpiles switch with multiple statements per case", () => {
            const result = (0, setup_1.transpile)(`
        function test(x: int): int {
          let result = 0;
          switch (x) {
            case 1:
              result = 10;
              result++;
              break;
            default:
              result = 0;
              break;
          }
          return result;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("result = 10");
            (0, vitest_1.expect)(result.cpp).toContain("result++");
        });
        (0, vitest_1.it)("transpiles switch with variable in case expression", () => {
            const result = (0, setup_1.transpile)(`
        function test(x: int): int {
          const one = 1;
          switch (x) {
            case 1:
              return one;
            default:
              return 0;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("switch (x)");
            (0, vitest_1.expect)(result.cpp).toContain("case 1:");
        });
        (0, vitest_1.it)("transpiles nested switch", () => {
            const result = (0, setup_1.transpile)(`
        function test(a: int, b: int): int {
          switch (a) {
            case 1:
              switch (b) {
                case 1:
                  return 11;
                default:
                  return 10;
              }
            default:
              return 0;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("switch (a)");
            (0, vitest_1.expect)(result.cpp).toContain("switch (b)");
        });
    });
    (0, vitest_1.describe)("Complex Control Flow", () => {
        (0, vitest_1.it)("transpiles nested loops with conditions", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let sum = 0;
          for (let i = 0; i < 10; i++) {
            if (i % 2 == 0) {
              for (let j = 0; j < i; j++) {
                sum += j;
              }
            }
          }
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("for (int i = 0");
            (0, vitest_1.expect)(result.cpp).toContain("if (i % 2 == 0)");
            (0, vitest_1.expect)(result.cpp).toContain("for (int j = 0");
        });
        (0, vitest_1.it)("transpiles labeled break in nested loops", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let found = 0;
          for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 10; j++) {
              if (i + j == 15) {
                found = i;
                break;
              }
            }
            if (found > 0) {
              break;
            }
          }
          return found;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("break");
        });
        (0, vitest_1.it)("transpiles while with switch inside", () => {
            const result = (0, setup_1.transpile)(`
        function test(): int {
          let state = 0;
          let count = 0;
          while (count < 10) {
            switch (state) {
              case 0:
                state = 1;
                break;
              case 1:
                state = 0;
                count++;
                break;
            }
          }
          return count;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("while (count < 10)");
            (0, vitest_1.expect)(result.cpp).toContain("switch (state)");
        });
        (0, vitest_1.it)("transpiles for loop inside if statement", () => {
            const result = (0, setup_1.transpile)(`
        function test(flag: bool): int {
          let sum = 0;
          if (flag) {
            for (let i = 0; i < 10; i++) {
              sum += i;
            }
          }
          return sum;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("if (flag)");
            (0, vitest_1.expect)(result.cpp).toContain("for (int i = 0");
        });
    });
});
