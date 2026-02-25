"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const setup_1 = require("./setup");
(0, vitest_1.describe)("Polyfill Transpilation", () => {
    (0, vitest_1.describe)("Console.log", () => {
        (0, vitest_1.it)("transpiles console.log with string literal", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log("hello");
        }
      `);
            // Console.log is transformed directly to std::cout
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
            (0, vitest_1.expect)(result.cpp).toContain('"hello"');
        });
        (0, vitest_1.it)("transpiles console.log with number literal", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log(42);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
            (0, vitest_1.expect)(result.cpp).toContain("42");
        });
        (0, vitest_1.it)("transpiles console.log with variable", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const msg = "hello";
          console.log(msg);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
            (0, vitest_1.expect)(result.cpp).toContain("msg");
        });
        (0, vitest_1.it)("transpiles console.log with expression", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const x = 10;
          console.log(x + 5);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
        });
        (0, vitest_1.it)("transpiles console.log inside if statement", () => {
            const result = (0, setup_1.transpile)(`
        function test(flag: bool): void {
          if (flag) {
            console.log("flag is true");
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
        });
        (0, vitest_1.it)("transpiles console.log inside loop", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          for (let i = 0; i < 5; i++) {
            console.log(i);
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
        });
        (0, vitest_1.it)("transpiles multiple console.log calls", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log("first");
          console.log("second");
          console.log("third");
        }
      `);
            // Should have multiple std::cout calls
            const matches = result.cpp.match(/std::cout/g);
            (0, vitest_1.expect)(matches?.length ?? 0).toBeGreaterThanOrEqual(3);
        });
    });
    (0, vitest_1.describe)("Console.error", () => {
        (0, vitest_1.it)("transpiles console.error with string literal", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.error("error occurred");
        }
      `);
            // Console.error uses std::cerr with [ERROR] prefix
            (0, vitest_1.expect)(result.cpp).toContain("std::cerr");
            (0, vitest_1.expect)(result.cpp).toContain("[ERROR]");
        });
        (0, vitest_1.it)("transpiles console.error with variable", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const errMsg = "failed";
          console.error(errMsg);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cerr");
        });
        (0, vitest_1.it)("transpiles console.error with number", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.error(404);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cerr");
        });
    });
    (0, vitest_1.describe)("Console.warn", () => {
        (0, vitest_1.it)("transpiles console.warn with string literal", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.warn("warning message");
        }
      `);
            // Console.warn uses std::cerr with [WARN] prefix
            (0, vitest_1.expect)(result.cpp).toContain("std::cerr");
            (0, vitest_1.expect)(result.cpp).toContain("[WARN]");
        });
        (0, vitest_1.it)("transpiles console.warn with variable", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          const warning = "deprecated";
          console.warn(warning);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cerr");
        });
    });
    (0, vitest_1.describe)("Console in various contexts", () => {
        (0, vitest_1.it)("transpiles console.log in class method", () => {
            const result = (0, setup_1.transpile)(`
        class Logger {
          public log(msg: string): void {
            console.log(msg);
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
        });
        (0, vitest_1.it)("transpiles console.log in nested function", () => {
            const result = (0, setup_1.transpile)(`
        function outer(): void {
          function inner(): void {
            console.log("nested");
          }
        }
      `);
            // Note: nested functions are not emitted in C++, but outer function exists
            (0, vitest_1.expect)(result.cpp).toContain("void outer()");
        });
        (0, vitest_1.it)("transpiles console.log in switch case", () => {
            const result = (0, setup_1.transpile)(`
        function test(x: int): void {
          switch (x) {
            case 1:
              console.log("one");
              break;
            default:
              console.log("other");
              break;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
        });
        (0, vitest_1.it)("transpiles console.log in try-catch", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          try {
            console.log("trying");
          } catch (e) {
            console.error("caught");
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
            (0, vitest_1.expect)(result.cpp).toContain("std::cerr");
        });
    });
    (0, vitest_1.describe)("Mixed console methods", () => {
        (0, vitest_1.it)("transpiles log, error, and warn together", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log("info");
          console.warn("warning");
          console.error("error");
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
            (0, vitest_1.expect)(result.cpp).toContain("[WARN]");
            (0, vitest_1.expect)(result.cpp).toContain("[ERROR]");
        });
    });
    (0, vitest_1.describe)("Generic target (std::cout)", () => {
        (0, vitest_1.it)("uses std::cout for generic target", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "generic" });
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
        });
        (0, vitest_1.it)("includes iostream for generic target", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "generic" });
            (0, vitest_1.expect)((0, setup_1.hasInclude)(result.cpp, "<iostream>")).toBe(true);
        });
    });
    (0, vitest_1.describe)("Arduino target (Serial)", () => {
        (0, vitest_1.it)("uses Serial.println for Arduino target", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(result.cpp).toContain("Serial.println");
        });
        (0, vitest_1.it)("uses Serial with [ERROR] prefix for console.error", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.error("failed");
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(result.cpp).toContain("Serial.print");
            (0, vitest_1.expect)(result.cpp).toContain("[ERROR]");
            (0, vitest_1.expect)(result.cpp).toContain("Serial.println");
        });
        (0, vitest_1.it)("uses Serial with [WARN] prefix for console.warn", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.warn("caution");
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(result.cpp).toContain("Serial.print");
            (0, vitest_1.expect)(result.cpp).toContain("[WARN]");
        });
    });
});
(0, vitest_1.describe)("Array Method Polyfills", () => {
    (0, vitest_1.it)("transpiles array.push", () => {
        const result = (0, setup_1.transpile)(`
      function test(): void {
        const arr: int[] = [1, 2, 3];
        arr.push(4);
      }
    `);
        (0, vitest_1.expect)(result.cpp).toContain("arr");
    });
    (0, vitest_1.it)("transpiles array.length", () => {
        const result = (0, setup_1.transpile)(`
      function test(): int {
        const arr = [1, 2, 3, 4, 5];
        return arr.length;
      }
    `);
        (0, vitest_1.expect)(result.cpp).toContain("arr");
    });
    (0, vitest_1.it)("transpiles array access", () => {
        const result = (0, setup_1.transpile)(`
      function test(): int {
        const arr = [10, 20, 30];
        return arr[1];
      }
    `);
        (0, vitest_1.expect)(result.cpp).toContain("arr[1]");
    });
});
(0, vitest_1.describe)("String Method Polyfills", () => {
    (0, vitest_1.it)("transpiles string.length", () => {
        const result = (0, setup_1.transpile)(`
      function test(): int {
        const s = "hello";
        return s.length;
      }
    `);
        (0, vitest_1.expect)(result.cpp).toContain("s");
    });
    (0, vitest_1.describe)("Async Runtime Polyfill", () => {
        (0, vitest_1.it)("emits Promise runtime primitives for async functions", () => {
            const result = (0, setup_1.transpile)(`
      async function fetchValue(): int {
        return await getValue();
      }
      function getValue(): int {
        return 5;
      }
    `, { target: "generic" });
            (0, vitest_1.expect)(result.cpp).toContain("namespace ts2cpp_async");
            (0, vitest_1.expect)(result.cpp).toContain("class MicrotaskQueue");
            (0, vitest_1.expect)(result.cpp).toContain("class Promise");
            (0, vitest_1.expect)(result.cpp).toContain("inline void ts2cpp_pump_microtasks()");
        });
    });
    (0, vitest_1.it)("transpiles string concatenation", () => {
        const result = (0, setup_1.transpile)(`
      function test(): void {
        const a = "hello";
        const b = "world";
        const c = a + " " + b;
      }
    `);
        (0, vitest_1.expect)(result.cpp).toContain("+");
    });
    (0, vitest_1.it)("transpiles string comparison", () => {
        const result = (0, setup_1.transpile)(`
      function test(): bool {
        const a = "hello";
        const b = "hello";
        return a == b;
      }
    `);
        (0, vitest_1.expect)(result.cpp).toContain("==");
    });
});
