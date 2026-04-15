import { describe, it } from "vitest";
import { expectCppContains, transpile } from "./setup";

describe("Class Transpilation", () => {
  describe("Basic Class Structure", () => {
    it("transpiles empty class", () => {
      const result = transpile(`
        class Empty {}
      `);
      expectCppContains(result, ["class Empty", "};"]);
    });

    it("transpiles class with public fields", () => {
      const result = transpile(`
        class Point {
          public x: int;
          public y: int;
        }
      `);
      expectCppContains(result, ["class Point", "public:", "int x", "int y"]);
    });

    it("transpiles class with field initializers", () => {
      const result = transpile(`
        class Counter {
          public count: int = 0;
        }
      `);
      expectCppContains(result, ["int count = 0"]);
    });

    it("transpiles class with private fields", () => {
      const result = transpile(`
        class Secret {
          private value: int;
        }
      `);
      expectCppContains(result, ["private:", "int value"]);
    });

    it("transpiles class with protected fields", () => {
      const result = transpile(`
        class Counter {
          protected count: int;
        }
      `);
      expectCppContains(result, ["protected:", "count"]);
    });

    it("transpiles class with mixed visibility fields", () => {
      const result = transpile(`
        class Mixed {
          public a: int;
          private b: int;
          protected c: int;
        }
      `);
      expectCppContains(result, ["public:", "private:", "protected:"]);
    });
  });

  describe("Class Methods", () => {
    it("transpiles class with public method", () => {
      const result = transpile(`
        class Greeter {
          public greet(): void {
            const msg = "hello";
          }
        }
      `);
      expectCppContains(result, ["void greet()"]);
    });

    it("transpiles class with method returning value", () => {
      const result = transpile(`
        class Calculator {
          public add(a: int, b: int): int {
            return a + b;
          }
        }
      `);
      expectCppContains(result, ["int add(int a, int b)"]);
    });

    it("transpiles class with private method", () => {
      const result = transpile(`
        class Secret {
          private helper(): int {
            return 42;
          }
        }
      `);
      expectCppContains(result, ["private:", "int helper()"]);
    });

    it("transpiles class with static method", () => {
      const result = transpile(`
        class Factory {
          public static create(): int {
            return 1;
          }
        }
      `);
      expectCppContains(result, ["static int create()"]);
    });

    it("transpiles class with multiple methods", () => {
      const result = transpile(`
        class Math {
          public add(a: int, b: int): int {
            return a + b;
          }
          public subtract(a: int, b: int): int {
            return a - b;
          }
        }
      `);
      expectCppContains(result, ["int add(int a, int b)", "int subtract(int a, int b)"]);
    });
  });

  describe("Constructors", () => {
    it("transpiles class with constructor", () => {
      const result = transpile(`
        class Point {
          public x: int;
          public y: int;
          constructor(x: int, y: int) {
            this.x = x;
            this.y = y;
          }
        }
      `);
      expectCppContains(result, ["Point(int x, int y)"]);
    });

    it("transpiles constructor with default parameter", () => {
      const result = transpile(`
        class Item {
          public value: int;
          constructor(value: int = 0) {
            this.value = value;
          }
        }
      `);
      expectCppContains(result, ["Item("]);
    });
  });

  describe("Complex Classes", () => {
    it("transpiles class with fields and methods", () => {
      const result = transpile(`
        class Counter {
          private count: int = 0;
          public increment(): void {
            this.count++;
          }
          public getCount(): int {
            return this.count;
          }
        }
      `);
      expectCppContains(result, ["class Counter", "void increment()", "int getCount()"]);
    });

    it("transpiles class with various field types", () => {
      const result = transpile(`
        class Data {
          public intValue: int;
          public floatValue: float;
          public boolValue: bool;
        }
      `);
      expectCppContains(result, ["int intValue", "float floatValue", "bool boolValue"]);
    });
  });
});