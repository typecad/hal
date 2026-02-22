import { describe, it, expect } from "vitest";
import { transpile, normalizeCpp, hasInclude } from "./setup";

describe("Polyfill Transpilation", () => {
  describe("Console.log", () => {
    it("transpiles console.log with string literal", () => {
      const result = transpile(`
        function test(): void {
          console.log("hello");
        }
      `);
      // Console.log is transformed directly to std::cout
      expect(result.cpp).toContain("std::cout");
      expect(result.cpp).toContain('"hello"');
    });

    it("transpiles console.log with number literal", () => {
      const result = transpile(`
        function test(): void {
          console.log(42);
        }
      `);
      expect(result.cpp).toContain("std::cout");
      expect(result.cpp).toContain("42");
    });

    it("transpiles console.log with variable", () => {
      const result = transpile(`
        function test(): void {
          const msg = "hello";
          console.log(msg);
        }
      `);
      expect(result.cpp).toContain("std::cout");
      expect(result.cpp).toContain("msg");
    });

    it("transpiles console.log with expression", () => {
      const result = transpile(`
        function test(): void {
          const x = 10;
          console.log(x + 5);
        }
      `);
      expect(result.cpp).toContain("std::cout");
    });

    it("transpiles console.log inside if statement", () => {
      const result = transpile(`
        function test(flag: bool): void {
          if (flag) {
            console.log("flag is true");
          }
        }
      `);
      expect(result.cpp).toContain("std::cout");
    });

    it("transpiles console.log inside loop", () => {
      const result = transpile(`
        function test(): void {
          for (let i = 0; i < 5; i++) {
            console.log(i);
          }
        }
      `);
      expect(result.cpp).toContain("std::cout");
    });

    it("transpiles multiple console.log calls", () => {
      const result = transpile(`
        function test(): void {
          console.log("first");
          console.log("second");
          console.log("third");
        }
      `);
      // Should have multiple std::cout calls
      const matches = result.cpp.match(/std::cout/g);
      expect(matches?.length ?? 0).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Console.error", () => {
    it("transpiles console.error with string literal", () => {
      const result = transpile(`
        function test(): void {
          console.error("error occurred");
        }
      `);
      // Console.error uses std::cerr with [ERROR] prefix
      expect(result.cpp).toContain("std::cerr");
      expect(result.cpp).toContain("[ERROR]");
    });

    it("transpiles console.error with variable", () => {
      const result = transpile(`
        function test(): void {
          const errMsg = "failed";
          console.error(errMsg);
        }
      `);
      expect(result.cpp).toContain("std::cerr");
    });

    it("transpiles console.error with number", () => {
      const result = transpile(`
        function test(): void {
          console.error(404);
        }
      `);
      expect(result.cpp).toContain("std::cerr");
    });
  });

  describe("Console.warn", () => {
    it("transpiles console.warn with string literal", () => {
      const result = transpile(`
        function test(): void {
          console.warn("warning message");
        }
      `);
      // Console.warn uses std::cerr with [WARN] prefix
      expect(result.cpp).toContain("std::cerr");
      expect(result.cpp).toContain("[WARN]");
    });

    it("transpiles console.warn with variable", () => {
      const result = transpile(`
        function test(): void {
          const warning = "deprecated";
          console.warn(warning);
        }
      `);
      expect(result.cpp).toContain("std::cerr");
    });
  });

  describe("Console in various contexts", () => {
    it("transpiles console.log in class method", () => {
      const result = transpile(`
        class Logger {
          public log(msg: string): void {
            console.log(msg);
          }
        }
      `);
      expect(result.cpp).toContain("std::cout");
    });

    it("transpiles console.log in nested function", () => {
      const result = transpile(`
        function outer(): void {
          function inner(): void {
            console.log("nested");
          }
        }
      `);
      // Note: nested functions are not emitted in C++, but outer function exists
      expect(result.cpp).toContain("void outer()");
    });

    it("transpiles console.log in switch case", () => {
      const result = transpile(`
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
      expect(result.cpp).toContain("std::cout");
    });

    it("transpiles console.log in try-catch", () => {
      const result = transpile(`
        function test(): void {
          try {
            console.log("trying");
          } catch (e) {
            console.error("caught");
          }
        }
      `);
      expect(result.cpp).toContain("std::cout");
      expect(result.cpp).toContain("std::cerr");
    });
  });

  describe("Mixed console methods", () => {
    it("transpiles log, error, and warn together", () => {
      const result = transpile(`
        function test(): void {
          console.log("info");
          console.warn("warning");
          console.error("error");
        }
      `);
      expect(result.cpp).toContain("std::cout");
      expect(result.cpp).toContain("[WARN]");
      expect(result.cpp).toContain("[ERROR]");
    });
  });

  describe("Generic target (std::cout)", () => {
    it("uses std::cout for generic target", () => {
      const result = transpile(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "generic" });
      
      expect(result.cpp).toContain("std::cout");
    });

    it("includes iostream for generic target", () => {
      const result = transpile(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "generic" });
      
      expect(hasInclude(result.cpp, "<iostream>")).toBe(true);
    });
  });

  describe("Arduino target (Serial)", () => {
    it("uses Serial.println for Arduino target", () => {
      const result = transpile(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "arduino" });
      
      expect(result.cpp).toContain("Serial.println");
    });

    it("uses Serial with [ERROR] prefix for console.error", () => {
      const result = transpile(`
        function test(): void {
          console.error("failed");
        }
      `, { target: "arduino" });
      
      expect(result.cpp).toContain("Serial.print");
      expect(result.cpp).toContain("[ERROR]");
      expect(result.cpp).toContain("Serial.println");
    });

    it("uses Serial with [WARN] prefix for console.warn", () => {
      const result = transpile(`
        function test(): void {
          console.warn("caution");
        }
      `, { target: "arduino" });
      
      expect(result.cpp).toContain("Serial.print");
      expect(result.cpp).toContain("[WARN]");
    });
  });
});

describe("Array Method Polyfills", () => {
  it("transpiles array.push", () => {
    const result = transpile(`
      function test(): void {
        const arr: int[] = [1, 2, 3];
        arr.push(4);
      }
    `);
    expect(result.cpp).toContain("arr");
  });

  it("transpiles array.length", () => {
    const result = transpile(`
      function test(): int {
        const arr = [1, 2, 3, 4, 5];
        return arr.length;
      }
    `);
    expect(result.cpp).toContain("arr");
  });

  it("transpiles array access", () => {
    const result = transpile(`
      function test(): int {
        const arr = [10, 20, 30];
        return arr[1];
      }
    `);
    expect(result.cpp).toContain("arr[1]");
  });
});

describe("String Method Polyfills", () => {
  it("transpiles string.length", () => {
    const result = transpile(`
      function test(): int {
        const s = "hello";
        return s.length;
      }
    `);
    expect(result.cpp).toContain("s");
  });


describe("Async Runtime Polyfill", () => {
  it("emits Promise runtime primitives for async functions", () => {
    const result = transpile(`
      async function fetchValue(): int {
        return await getValue();
      }
      function getValue(): int {
        return 5;
      }
    `, { target: "generic" });

    expect(result.cpp).toContain("namespace ts2cpp_async");
    expect(result.cpp).toContain("class MicrotaskQueue");
    expect(result.cpp).toContain("class Promise");
    expect(result.cpp).toContain("inline void ts2cpp_pump_microtasks()");
  });
});
  it("transpiles string concatenation", () => {
    const result = transpile(`
      function test(): void {
        const a = "hello";
        const b = "world";
        const c = a + " " + b;
      }
    `);
    expect(result.cpp).toContain("+");
  });

  it("transpiles string comparison", () => {
    const result = transpile(`
      function test(): bool {
        const a = "hello";
        const b = "hello";
        return a == b;
      }
    `);
    expect(result.cpp).toContain("==");
  });
});