import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseBoardSpec,
  safeParseBoardSpec,
  stripJsonc,
  scaffoldBoardPackages,
  BoardGenerators,
} from "@typecad/cuttlefish/testing";

const C6_FIXTURE = path.resolve(__dirname, '../../fixtures/esp32c6-spec.jsonc');

describe("board-codegen", () => {
  describe("stripJsonc", () => {
    it("strips line comments", () => {
      expect(JSON.parse(stripJsonc('{"a": 1 // comment\n}'))).toEqual({ a: 1 });
    });
    it("strips block comments", () => {
      expect(JSON.parse(stripJsonc('{"a": /* x */ 1}'))).toEqual({ a: 1 });
    });
    it("preserves // inside strings", () => {
      expect(JSON.parse(stripJsonc('{"url": "http://x.com"}'))).toEqual({ url: "http://x.com" });
    });
  });

  describe("parseBoardSpec", () => {
    it("parses the C6 fixture", () => {
      const text = fs.readFileSync(C6_FIXTURE, 'utf8');
      const spec = parseBoardSpec(text);
      expect(spec.architecture).toBe('esp32c6');
      expect(spec.fqbn).toBe('esp32:esp32:esp32c6');
    });

    it("rejects a missing required field", () => {
      const result = safeParseBoardSpec('{"architecture": "test"}');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe("generators", () => {
    const spec = parseBoardSpec(fs.readFileSync(C6_FIXTURE, 'utf8'));

    it("genMcuPackageJson produces valid JSON with correct name", () => {
      const content = BoardGenerators.genMcuPackageJson(spec);
      const parsed = JSON.parse(content);
      expect(parsed.name).toBe('@typecad/mcu-esp32c6');
      expect(parsed.dependencies['@typecad/cuttlefish']).toBe('*');
    });

    it("genMcuPins includes the GPIO range", () => {
      const content = BoardGenerators.genMcuPins(spec);
      expect(content).toContain('export const GPIO0');
      expect(content).toContain('export const GPIO30');
    });

    it("genMcuIndex contains the architecture and FQBN-derived define", () => {
      const content = BoardGenerators.genMcuIndex(spec);
      expect(content).toContain("architecture: 'esp32c6'");
      expect(content).toContain('ESP32C6: MCUDefinition');
    });

    it("genBoardIndex contains the FQBN", () => {
      const content = BoardGenerators.genBoardIndex(spec);
      expect(content).toContain("arduino: 'esp32:esp32:esp32c6'");
    });

    it("genBoardPins generates Dx and Ax aliases", () => {
      const content = BoardGenerators.genBoardPins(spec);
      expect(content).toContain('export const D0');
      expect(content).toContain('export const A0');
    });
  });

  describe("scaffoldBoardPackages", () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'board-codegen-test-'));
    });
    afterEach(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("creates all expected MCU + board package files", () => {
      const spec = parseBoardSpec(fs.readFileSync(C6_FIXTURE, 'utf8'));
      const result = scaffoldBoardPackages(spec, { rootDir: tmpRoot });

      const fileNames = result.createdFiles.map(f => path.relative(tmpRoot, f));
      // MCU package
      expect(fileNames).toContain(path.join('packages/mcu-esp32c6/package.json'));
      expect(fileNames).toContain(path.join('packages/mcu-esp32c6/src/index.ts'));
      expect(fileNames).toContain(path.join('packages/mcu-esp32c6/src/pins.ts'));
      expect(fileNames).toContain(path.join('packages/mcu-esp32c6/src/peripherals.ts'));
      // Board package
      expect(fileNames).toContain(path.join('packages/board-esp32c6/package.json'));
      expect(fileNames).toContain(path.join('packages/board-esp32c6/src/index.ts'));
      expect(fileNames).toContain(path.join('packages/board-esp32c6/src/pins.ts'));
      expect(fileNames).toContain(path.join('packages/board-esp32c6/src/analog.ts'));
      expect(fileNames).toContain(path.join('packages/board-esp32c6/src/board.ts'));
    });

    it("refuses to overwrite without --force", () => {
      const spec = parseBoardSpec(fs.readFileSync(C6_FIXTURE, 'utf8'));
      scaffoldBoardPackages(spec, { rootDir: tmpRoot });
      expect(() => scaffoldBoardPackages(spec, { rootDir: tmpRoot })).toThrow(/already exists/);
    });

    it("overwrites with --force", () => {
      const spec = parseBoardSpec(fs.readFileSync(C6_FIXTURE, 'utf8'));
      scaffoldBoardPackages(spec, { rootDir: tmpRoot });
      expect(() => scaffoldBoardPackages(spec, { rootDir: tmpRoot, force: true })).not.toThrow();
    });

    it("returns a framework checklist mentioning all 6 framework spots", () => {
      const spec = parseBoardSpec(fs.readFileSync(C6_FIXTURE, 'utf8'));
      const result = scaffoldBoardPackages(spec, { rootDir: tmpRoot });
      expect(result.checklist).toContain('board-types.ts');
      expect(result.checklist).toContain('freeHeap');
      expect(result.checklist).toContain('isrFunctionAttribute');
      expect(result.checklist).toContain('heap-analysis');
      expect(result.checklist).toContain('PROFILE_VARIANTS');
    });
  });
});
