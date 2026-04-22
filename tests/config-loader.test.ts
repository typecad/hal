import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findConfigFile, parseConfigFile, loadTypecodeConfig, generateVirtualTypeDeclaration } from "../packages/cli/src/config-loader";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
});

describe("config-loader", () => {
  describe("findConfigFile", () => {
    it("finds typecode.config.ts in the given directory", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typecode.config.ts");
      fs.writeFileSync(configPath, "export default {};", "utf-8");

      expect(findConfigFile(dir)).toBe(configPath);
    });

    it("walks up to find typecode.config.ts in a parent directory", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typecode.config.ts");
      fs.writeFileSync(configPath, "export default {};", "utf-8");

      const subDir = path.join(dir, "src", "nested");
      fs.mkdirSync(subDir, { recursive: true });

      expect(findConfigFile(subDir)).toBe(configPath);
    });

    it("returns undefined when no config file exists", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-cfg-"));
      tempDirs.push(dir);

      // Don't create any config file
      expect(findConfigFile(dir)).toBeUndefined();
    });
  });

  describe("parseConfigFile", () => {
    it("parses a config file with all fields", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typecode.config.ts");
      fs.writeFileSync(
        configPath,
        [
          "const config = {",
          "  target: 'avr',",
          "  board: '@typecode/board-arduino-uno',",
          "  fqbn: 'arduino:avr:uno',",
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
      expect(result!.board).toBe("@typecode/board-arduino-uno");
      expect(result!.fqbn).toBe("arduino:avr:uno");
      expect(result!.outputFramework).toBe("arduino");
      expect(result!.outputOptimize).toBe("size");
      expect(result!.outputOutDir).toBe("./out");
      expect(result!.configPath).toBe(configPath);
    });

    it("parses config with inline export default", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typecode.config.ts");
      fs.writeFileSync(
        configPath,
        [
          "export default {",
          "  target: 'esp32',",
          "  board: '@typecode/board-esp32-devkit',",
          "  fqbn: 'esp32:esp32:esp32doit-devkit-v1',",
          "};",
        ].join("\n"),
        "utf-8",
      );

      const result = parseConfigFile(configPath);
      expect(result).toBeDefined();
      expect(result!.target).toBe("esp32");
      expect(result!.board).toBe("@typecode/board-esp32-devkit");
      expect(result!.fqbn).toBe("esp32:esp32:esp32doit-devkit-v1");
    });

    it("returns undefined for empty file", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typecode.config.ts");
      fs.writeFileSync(configPath, "// empty config\n", "utf-8");

      const result = parseConfigFile(configPath);
      expect(result).toBeUndefined();
    });

    it("handles config with only board and fqbn", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typecode.config.ts");
      fs.writeFileSync(
        configPath,
        [
          "const config = {",
          "  board: '@typecode/board-arduino-uno',",
          "  fqbn: 'arduino:avr:uno',",
          "};",
          "export default config;",
        ].join("\n"),
        "utf-8",
      );

      const result = parseConfigFile(configPath);
      expect(result).toBeDefined();
      expect(result!.board).toBe("@typecode/board-arduino-uno");
      expect(result!.fqbn).toBe("arduino:avr:uno");
      expect(result!.target).toBeUndefined();
    });
  });

  describe("loadTypecodeConfig", () => {
    it("returns config when typecode.config.ts exists", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typecode.config.ts");
      fs.writeFileSync(
        configPath,
        [
          "const config = {",
          "  target: 'avr',",
          "  board: '@typecode/board-arduino-uno',",
          "  fqbn: 'arduino:avr:uno',",
          "};",
          "export default config;",
        ].join("\n"),
        "utf-8",
      );

      const result = loadTypecodeConfig(dir);
      expect(result).toBeDefined();
      expect(result!.board).toBe("@typecode/board-arduino-uno");
    });

    it("generates typecode-env.d.ts with volatile helper declaration", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-cfg-"));
      tempDirs.push(dir);

      const configPath = path.join(dir, "typecode.config.ts");
      fs.writeFileSync(
        configPath,
        [
          "const config = {",
          "  board: '@typecode/board-arduino-uno',",
          "  fqbn: 'arduino:avr:uno',",
          "};",
          "export default config;",
        ].join("\n"),
        "utf-8",
      );

      const config = parseConfigFile(configPath);
      expect(config).toBeDefined();
      generateVirtualTypeDeclaration(config!);

      const envPath = path.join(dir, "typecode-env.d.ts");
      const envContent = fs.readFileSync(envPath, "utf-8");
      expect(envContent).toContain("declare function volatile<T>(value: T): T;");
    });

    it("returns undefined when no config file exists", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-cfg-"));
      tempDirs.push(dir);

      const result = loadTypecodeConfig(dir);
      expect(result).toBeUndefined();
    });
  });
});
