import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findConfigFile, parseConfigFile, loadTypehalConfig, generateVirtualTypeDeclaration } from "@typehal/transpiler/testing";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
});

describe("config-loader", () => {
  describe("findConfigFile", () => {
    it("finds typehal.config.ts in the given directory", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typehal.config.ts");
      fs.writeFileSync(configPath, "export default {};", "utf-8");

      expect(findConfigFile(dir)).toBe(configPath);
    });

    it("walks up to find typehal.config.ts in a parent directory", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typehal.config.ts");
      fs.writeFileSync(configPath, "export default {};", "utf-8");

      const subDir = path.join(dir, "src", "nested");
      fs.mkdirSync(subDir, { recursive: true });

      expect(findConfigFile(subDir)).toBe(configPath);
    });

    it("returns undefined when no config file exists", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-cfg-"));
      tempDirs.push(dir);

      // Don't create any config file
      expect(findConfigFile(dir)).toBeUndefined();
    });
  });

  describe("parseConfigFile", () => {
    it("parses a config file with all fields", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typehal.config.ts");
      fs.writeFileSync(
        configPath,
        [
          "const config = {",
          "  target: 'avr',",
          "  mcu: '@typehal/mcu-atmega328p',",
          "  board: '@typehal/board-arduino-uno',",
          "  frameworkData: { buildTarget: 'arduino:avr:uno' },",
          "  output: {",
          "    framework: 'arduino',",
          "    optimize: 'size',",
          "    outDir: './out',",
          "  },",
          "};",
          "export default config;",
        ].join("\n"),
        "utf-8",
      );

      const result = parseConfigFile(configPath);
      expect(result).toBeDefined();
      expect(result!.target).toBe("avr");
      expect(result!.board).toBe("@typehal/board-arduino-uno");
      expect(result!.buildTarget).toBe("arduino:avr:uno");
      expect(result!.outputFramework).toBe("arduino");
      expect(result!.outputOptimize).toBe("size");
      expect(result!.outputOutDir).toBe("./out");
      expect(result!.configPath).toBe(configPath);
    });

    it("parses config with inline export default", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typehal.config.ts");
      fs.writeFileSync(
        configPath,
        [
          "export default {",
          "  target: 'esp32',",
          "  mcu: '@typehal/mcu-esp32',",
          "  board: '@typehal/board-esp32-devkit',",
          "  frameworkData: { buildTarget: 'esp32:esp32:esp32doit-devkit-v1' },",
          "};",
        ].join("\n"),
        "utf-8",
      );

      const result = parseConfigFile(configPath);
      expect(result).toBeDefined();
      expect(result!.target).toBe("esp32");
      expect(result!.board).toBe("@typehal/board-esp32-devkit");
      expect(result!.buildTarget).toBe("esp32:esp32:esp32doit-devkit-v1");
    });

    it("returns undefined for empty file", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typehal.config.ts");
      fs.writeFileSync(configPath, "// empty config\n", "utf-8");

      const result = parseConfigFile(configPath);
      expect(result).toBeUndefined();
    });

    it("handles config with only board and fqbn", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typehal.config.ts");
      fs.writeFileSync(
        configPath,
        [
          "const config = {",
          "  target: 'avr',",
          "  mcu: '@typehal/mcu-atmega328p',",
          "  board: '@typehal/board-arduino-uno',",
          "  frameworkData: { buildTarget: 'arduino:avr:uno' },",
          "};",
          "export default config;",
        ].join("\n"),
        "utf-8",
      );

      const result = parseConfigFile(configPath);
      expect(result).toBeDefined();
      expect(result!.board).toBe("@typehal/board-arduino-uno");
      expect(result!.buildTarget).toBe("arduino:avr:uno");
      expect(result!.target).toBe("avr");
    });
  });

  describe("loadTypehalConfig", () => {
    it("returns config when typehal.config.ts exists", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typehal.config.ts");
      fs.writeFileSync(
        configPath,
        [
          "const config = {",
          "  target: 'avr',",
          "  mcu: '@typehal/mcu-atmega328p',",
          "  board: '@typehal/board-arduino-uno',",
          "  frameworkData: { buildTarget: 'arduino:avr:uno' },",
          "};",
          "export default config;",
        ].join("\n"),
        "utf-8",
      );

      const result = loadTypehalConfig(dir);
      expect(result).toBeDefined();
      expect(result!.board).toBe("@typehal/board-arduino-uno");
    });

    it("generates typehal-env.d.ts with volatile helper declaration", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typehal.config.ts");
      fs.writeFileSync(
        configPath,
        [
          "const config = {",
          "  target: 'avr',",
          "  mcu: '@typehal/mcu-atmega328p',",
          "  board: '@typehal/board-arduino-uno',",
          "  frameworkData: { buildTarget: 'arduino:avr:uno' },",
          "};",
          "export default config;",
        ].join("\n"),
        "utf-8",
      );

      const config = parseConfigFile(configPath);
      expect(config).toBeDefined();
      generateVirtualTypeDeclaration(config!);

      const envPath = path.join(dir, "typehal-env.d.ts");
      const envContent = fs.readFileSync(envPath, "utf-8");
      expect(envContent).toContain("declare function volatile<T>(value: T): T;");
    });

    it("returns undefined when no config file exists", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-cfg-"));
      tempDirs.push(dir);

      const result = loadTypehalConfig(dir);
      expect(result).toBeUndefined();
    });
  });
});
