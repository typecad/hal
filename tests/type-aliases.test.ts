import { describe, it } from "vitest";
import { expectCppContains, transpile } from "./setup";

describe("Type Aliases", () => {
  it("transpiles an object type alias when used in a function signature", () => {
    const result = transpile(`
      type Point = { x: int; y: int };
      function getX(p: Point): int {
        return p.x;
      }
    `);

    expectCppContains(result, ["int getX(", "return p.x"]);
  });

  it("transpiles a simple type alias in parameters and keeps the alias definition", () => {
    const result = transpile(`
      type ID = int;
      function normalize(id: ID): ID {
        return id;
      }
    `);

    expectCppContains(result, ["using ID = int;", "normalize(int id)", "return id"]);
  });
});