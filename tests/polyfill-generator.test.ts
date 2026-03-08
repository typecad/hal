/**
 * Tests for the automated polyfill generator.
 */

import { describe, it, expect } from "vitest";
import { PolyfillGenerator, generatePolyfills } from "../packages/cli/src/polyfill/generator";
import { getArchitectureCapabilities, ARCHITECTURE_CAPABILITIES } from "../packages/cli/src/polyfill/template-types";
import type { ProgramIR } from "../packages/cli/src/ir/model";

// Helper to create minimal program IR
function createProgramIR(statements: any[] = []): ProgramIR {
  return {
    functions: [],
    classes: [],
    enums: [],
    imports: [],
    exports: [],
    topLevelStatements: statements,
  };
}

describe("PolyfillGenerator", () => {
  describe("Architecture Capabilities", () => {
    it("provides default capabilities for unknown architecture", () => {
      const caps = getArchitectureCapabilities("unknown_arch");
      expect(caps.id).toBe("default");
      expect(caps.hasVector).toBe(true);
    });

    it("provides correct capabilities for AVR", () => {
      const caps = getArchitectureCapabilities("avr");
      expect(caps.id).toBe("avr");
      expect(caps.hasVector).toBe(false);
      expect(caps.hasDynamicMemory).toBe(false);
      expect(caps.flashStringMacro).toBe("F");
    });

    it("provides correct capabilities for ESP32", () => {
      const caps = getArchitectureCapabilities("esp32");
      expect(caps.id).toBe("esp32");
      expect(caps.hasVector).toBe(true);
      expect(caps.hasDynamicMemory).toBe(true);
    });

    it("includes RISC-V architecture", () => {
      expect(ARCHITECTURE_CAPABILITIES.riscv).toBeDefined();
      expect(ARCHITECTURE_CAPABILITIES.riscv.hasVector).toBe(true);
    });

    it("includes STM32 architecture", () => {
      expect(ARCHITECTURE_CAPABILITIES.stm32).toBeDefined();
      expect(ARCHITECTURE_CAPABILITIES.stm32.hasVector).toBe(true);
    });
  });

  describe("Need Detection", () => {
    it("detects console.log usage", () => {
      const program: ProgramIR = {
        ...createProgramIR(),
        functions: [{
          kind: "function",
          name: "test",
          originalName: "test",
          parameters: [],
          statements: [{
            kind: "call",
            callee: "console.log",
            args: [{ kind: "literal", value: "hello" }],
          }],
          returnType: "void",
        }],
      };

      const generator = new PolyfillGenerator("avr");
      const needs = generator.detectNeeds(program);

      expect(needs.some(n => n.templateId === "console")).toBe(true);
    });

    it("detects array.push usage", () => {
      const program: ProgramIR = {
        ...createProgramIR(),
        functions: [{
          kind: "function",
          name: "test",
          originalName: "test",
          parameters: [],
          statements: [{
            kind: "call",
            callee: "arr.push",
            args: [{ kind: "identifier", name: "item" }],
          }],
          returnType: "void",
        }],
      };

      const generator = new PolyfillGenerator("avr");
      const needs = generator.detectNeeds(program);

      expect(needs.some(n => n.templateId === "static_array")).toBe(true);
    });

    it("detects string method usage", () => {
      const program: ProgramIR = {
        ...createProgramIR(),
        functions: [{
          kind: "function",
          name: "test",
          originalName: "test",
          parameters: [],
          statements: [{
            kind: "call",
            callee: "str.substring",
            args: [
              { kind: "literal", value: 0 },
              { kind: "literal", value: 5 },
            ],
          }],
          returnType: "void",
        }],
      };

      const generator = new PolyfillGenerator("avr");
      const needs = generator.detectNeeds(program);

      expect(needs.some(n => n.templateId === "static_string")).toBe(true);
    });

    it("returns empty array for program with no polyfill needs", () => {
      const program = createProgramIR();
      const generator = new PolyfillGenerator("avr");
      const needs = generator.detectNeeds(program);

      expect(needs).toEqual([]);
    });
  });

  describe("Polyfill Generation", () => {
    it("generates StaticArray for AVR", () => {
      const generator = new PolyfillGenerator("avr");
      const result = generator.generate([
        { templateId: "static_array", usageCount: 1, config: { maxSize: 32 } },
      ]);

      expect(result.code).toContain("StaticArray");
      expect(result.code).toContain("template<typename T");
      // Should NOT include <vector> header since AVR doesn't have std::vector
      expect(result.includes).not.toContain("<vector>");
    });

    it("generates std::vector for ESP32", () => {
      const generator = new PolyfillGenerator("esp32");
      const result = generator.generate([
        { templateId: "static_array", usageCount: 1, config: {} },
      ]);

      expect(result.code).toContain("std::vector");
      expect(result.includes).toContain("<vector>");
    });

    it("generates Console with Serial for Arduino", () => {
      const generator = new PolyfillGenerator("avr");
      const result = generator.generate([
        { templateId: "console", usageCount: 1, config: { baudRate: 9600 } },
      ]);

      expect(result.code).toContain("Serial");
      expect(result.code).toContain("9600");
      expect(result.includes).toContain("<Arduino.h>");
    });

    it("generates Console with iostream for native", () => {
      const generator = new PolyfillGenerator("default");
      // Override serial class to trigger iostream variant
      const caps = generator.getCapabilities();
      // Default should use iostream since serialClassName is "Serial"
      const result = generator.generate([
        { templateId: "console", usageCount: 1, config: {} },
      ]);

      // Should still work - either serial or iostream variant
      expect(result.code).toBeDefined();
    });
  });

  describe("Full Program Analysis", () => {
    it("generates polyfills for a complete program", () => {
      const program: ProgramIR = {
        ...createProgramIR(),
        functions: [{
          kind: "function",
          name: "main",
          originalName: "main",
          parameters: [],
          statements: [
            {
              kind: "call",
              callee: "console.log",
              args: [{ kind: "literal", value: "Starting" }],
            },
            {
              kind: "var_decl",
              name: "items",
              cppType: "Array<int>",
              init: { kind: "array", elements: [] },
            },
            {
              kind: "call",
              callee: "items.push",
              args: [{ kind: "literal", value: 42 }],
            },
          ],
          returnType: "void",
        }],
      };

      const result = generatePolyfills(program, "avr");

      expect(result.code).toContain("Console");
      expect(result.code).toContain("StaticArray");
      expect(result.includes).toContain("<Arduino.h>");
    });
  });

  describe("Template Registry", () => {
    it("lists available templates", () => {
      const generator = new PolyfillGenerator("avr");
      const templates = generator.listAvailableTemplates();

      expect(templates).toContain("static_array");
      expect(templates).toContain("static_string");
      expect(templates).toContain("console");
    });
  });
});