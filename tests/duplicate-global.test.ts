import { describe, it, expect } from "vitest";
import { transpile } from "./setup";

describe("Duplicate Global Declarations", () => {
  it("handles variable declared at global scope and inside main", () => {
    const result = transpile(`
      const x = 5;

      function main(): void {
        const x = 10;
        console.log(x);
      }
    `);

    console.log("Generated C++:\n", result.cpp);
    
    // Both should be present - different scopes
    expect(result.cpp).toContain("const int x = 5");
    expect(result.cpp).toContain("const int x = 10");
  });

  it("handles same variable name declared globally and in setup/loop", () => {
    const result = transpile(`
      const led = 13;

      function setup(): void {
        const led = 5;
        console.log(led);
      }

      function loop(): void {
      }
    `, { target: "arduino" });

    console.log("Generated C++:\n", result.cpp);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("handles var declarations at global scope and inside main", () => {
    const result = transpile(`
      var x = 5;

      function main(): void {
        var x = 10;
        console.log(x);
      }
    `);

    console.log("Generated C++:\n", result.cpp);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("detects potential duplicate global declarations when using same mutable variable", () => {
    const result = transpile(`
      let counter = 0;

      function main(): void {
        counter = 10;
        console.log(counter);
      }
    `);

    console.log("Generated C++:\n", result.cpp);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("handles ISR referencing a globally declared variable", () => {
    const result = transpile(`
      const sensorPin = 13;

      function setup(): void {
        pinMode(sensorPin, OUTPUT);
      }

      function loop(): void {
        digitalWrite(sensorPin, HIGH);
      }
    `, { target: "arduino" });

    console.log("Generated C++:\n", result.cpp);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.cpp).toContain("const int sensorPin = 13");
    expect(result.cpp).toContain("pinMode(sensorPin, OUTPUT)");
  });

  it("handles ISR-promoted variable that was also declared globally (potential duplicate)", () => {
    // This is the problematic case:
    // 1. A global var declaration
    // 2. A local var declaration inside setup() with the SAME name
    // 3. The local var is referenced by an ISR, causing promotion
    const result = transpile(`
      let counter = 0;

      function setup(): void {
        let counter = 10;
        attachInterrupt(digitalPinToInterrupt(2), () => {
          counter = digitalRead(3);
        }, RISING);
      }

      function loop(): void {
      }
    `, { target: "arduino" });

    console.log("Generated C++:\n", result.cpp);
    console.log("Diagnostics:", result.diagnostics);
    // Check for duplicate declarations - should only have ONE global 'counter'
    const globalDeclCount = (result.cpp.match(/int counter/g) || []).length;
    console.log("Global declaration count:", globalDeclCount);
    // The fix ensures only one global declaration exists
    expect(globalDeclCount).toBe(1);
    // Filter out ownership diagnostics which are a separate concern
    const nonOwnershipDiagnostics = result.diagnostics.filter(d => d.code !== "ownership-suggest-const");
    expect(nonOwnershipDiagnostics).toHaveLength(0);
  });
});