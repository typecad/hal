import { describe, it, expect } from "vitest";
import { transpile } from "./setup";

describe("Type Aliases", () => {
  it("transpiles object type alias without failing", () => {
    const result = transpile(`
      type Point = { x: int; y: int };
    `);

    expect(result.cpp).toBeDefined();
  });

  it("transpiles simple type alias without failing", () => {
    const result = transpile(`
      type ID = int;
    `);

    expect(result.cpp).toBeDefined();
  });
});