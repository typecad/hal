import { describe, it, expect } from "vitest";
import { expectCppContains, transpile } from "./setup";

describe("Enum Transpilation", () => {
  describe("Basic Enums", () => {
    it("transpiles simple enum", () => {
      const result = transpile(`
        enum Color {
          Red,
          Green,
          Blue
        }
      `);
      expectCppContains(result, ["enum class Color", "Red", "Green", "Blue"]);
    });

    it("transpiles enum with explicit values", () => {
      const result = transpile(`
        enum Status {
          Ok = 200,
          NotFound = 404,
          Error = 500
        }
      `);
      expectCppContains(result, ["Ok = 200", "NotFound = 404", "Error = 500"]);
    });

    it("transpiles const enum", () => {
      const result = transpile(`
        const enum Direction {
          Up,
          Down,
          Left,
          Right
        }
      `);
      expectCppContains(result, ["enum class Direction"]);
    });

    it("transpiles enum with mixed explicit and implicit values", () => {
      const result = transpile(`
        enum Mixed {
          A,
          B = 10,
          C,
          D = 20
        }
      `);
      expectCppContains(result, ["A", "B = 10", "C", "D = 20"]);
    });
  });

  describe("Enum Usage", () => {
    it("transpiles enum used in function", () => {
      const result = transpile(`
        enum Color { Red, Green, Blue }
        function isRed(c: Color): bool {
          return c == Color.Red;
        }
      `);
      expectCppContains(result, ["enum class Color", "isRed("]);
      expect(result.cpp).toMatch(/return\s+c\s*==\s*Color(?:::|\.)Red/);
    });
  });
});