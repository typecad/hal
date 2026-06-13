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
      expect(result.cpp).toMatch(/return\s+(?:static_cast<int>\()?c\)?\s*==\s*(?:static_cast<int>\()?Color(?:::|\.)Red/);
    });

    it("wraps enum operands in static_cast<int> for relational comparison", () => {
      const result = transpile(`
        enum Color { Red, Green, Blue }
        function test(c: Color): bool {
          return c >= Color.Green;
        }
      `);
      expect(result.cpp).toMatch(/static_cast<int>\(/);
    });

    it("uses :: for enum member access at module scope in new expression args", () => {
      const result = transpile(`
        enum SensorKind { Temperature = 0, Humidity = 1, Pressure = 2 }
        class Reader {
          kind: number;
          constructor(kind: number) {
            this.kind = kind;
          }
        }
        const r = new Reader(SensorKind.Temperature);
      `);
      expectCppContains(result, ["SensorKind::Temperature"]);
      expect(result.cpp).not.toContain("SensorKind.Temperature");
    });

    it("uses :: for enum member access in variable initializer", () => {
      const result = transpile(`
        enum Mode { Read = 0, Write = 1 }
        const m = Mode.Write;
      `);
      expectCppContains(result, ["Mode::Write"]);
      expect(result.cpp).not.toContain("Mode.Write");
    });
  });

  describe("Enum Type Preservation", () => {
    it("preserves enum type for variable assigned enum value", () => {
      const result = transpile(`
        enum AlertLevel { Nominal = 0, Warning = 1, Critical = 2 }
        const level = AlertLevel.Warning;
      `);
      expect(result.cpp).toContain("AlertLevel level = AlertLevel::Warning");
      expect(result.cpp).not.toContain("long long level");
    });

    it("preserves enum type in variable declarations", () => {
      const result = transpile(`
        enum Color { Red, Green, Blue }
        const c = Color.Red;
      `);
      expect(result.cpp).toContain("Color c = Color::Red");
    });

    it("preserves enum type in function body", () => {
      const result = transpile(`
        enum Status { Ok = 0, Error = 1 }
        function getStatus(): number {
          const s = Status.Ok;
          return 0;
        }
      `);
      expect(result.cpp).toContain("Status s = Status::Ok");
    });
  });
});