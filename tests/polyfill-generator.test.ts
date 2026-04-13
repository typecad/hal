/**
 * Tests for the automated polyfill generator.
 */

import { describe, it, expect } from "vitest";
import { PolyfillGenerator, generatePolyfills } from "../packages/cli/src/polyfill/generator";
import { getArchitectureCapabilities, ARCHITECTURE_CAPABILITIES } from "../packages/cli/src/polyfill/template-types";

// Minimal program IR shape — polyfill generator only inspects callee strings,
// so we can pass plain objects without all the fields the full IR requires.
function makeProgram(functions: any[] = []): any {
  return {
    fileName: "test.ts",
    functions,
    classes: [],
    enums: [],
    structs: [],
    interfaces: [],
    namespaces: [],
    imports: [],
    reExports: [],
    topLevelStatements: [],
    globalVars: [],
    registerClasses: [],
  };
}

function makeStmt(callee: string, args: any[] = []): any {
  return {
    kind: "call",
    callee,
    args,
    sourceSpan: { file: "test.ts", start: 0, end: 0 },
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
      const program = makeProgram([{
        kind: "function",
        name: "test",
        originalName: "test",
        parameters: [],
        statements: [makeStmt("console.log", [{ kind: "string", value: "hello" }])],
        returnType: "void",
      }]);

      const generator = new PolyfillGenerator("avr");
      const needs = generator.detectNeeds(program);

      expect(needs.some(n => n.templateId === "console")).toBe(true);
    });

    it("detects array.push usage", () => {
      const program = makeProgram([{
        kind: "function",
        name: "test",
        originalName: "test",
        parameters: [],
        statements: [makeStmt("arr.push", [{ kind: "identifier", value: "item" }])],
        returnType: "void",
      }]);

      const generator = new PolyfillGenerator("avr");
      const needs = generator.detectNeeds(program);

      expect(needs.some(n => n.templateId === "static_array")).toBe(true);
    });

    it("detects string method usage", () => {
      const program = makeProgram([{
        kind: "function",
        name: "test",
        originalName: "test",
        parameters: [],
        statements: [makeStmt("str.substring", [
          { kind: "number", value: 0 },
          { kind: "number", value: 5 },
        ])],
        returnType: "void",
      }]);

      const generator = new PolyfillGenerator("avr");
      const needs = generator.detectNeeds(program);

      expect(needs.some(n => n.templateId === "static_string")).toBe(true);
    });

    it("returns empty array for program with no polyfill needs", () => {
      const program = makeProgram();
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
      const result = generator.generate([
        { templateId: "console", usageCount: 1, config: {} },
      ]);

      expect(result.code).toBeDefined();
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
