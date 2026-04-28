// ---------------------------------------------------------------------------
// Tests for `typehal init` project scaffolding
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  scaffoldProject,
  normalizeProjectName,
  KNOWN_BOARDS,
} from "../../../packages/transpiler/src/scaffold/init-scaffold";
import {
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterSketch,
  generateGitignore,
  type InitProjectOptions,
} from "../../../packages/transpiler/src/scaffold/init-templates";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ARDUINO_UNO_OPTIONS: InitProjectOptions = {
  projectName: 'test-project',
  boardId: 'arduino-uno',
  boardDisplayName: 'Arduino Uno',
  architecture: 'avr',
  boardPackage: '@typehal/board-arduino-uno',
  frameworkPackage: '@typehal/framework-arduino',
  framework: 'arduino',
  fqbn: 'arduino:avr:uno',
  mcu: 'ATmega328P',
  baudRate: 9600,
  includeSketch: true,
};

// ---------------------------------------------------------------------------
// Template tests
// ---------------------------------------------------------------------------

describe("init-templates", () => {
  describe("generateProjectPackageJson", () => {
    it("produces valid JSON with correct dependencies", () => {
      const content = generateProjectPackageJson(ARDUINO_UNO_OPTIONS);
      const parsed = JSON.parse(content);

      expect(parsed.name).toBe('test-project');
      expect(parsed.private).toBe(true);
      expect(parsed.dependencies['@typehal/core']).toBe('^0.1.0');
      expect(parsed.dependencies['@typehal/board-arduino-uno']).toBe('^0.1.0');
      expect(parsed.dependencies['@typehal/framework-arduino']).toBe('^0.1.0');
      expect(parsed.scripts.build).toContain('typehal');
      expect(parsed.scripts.compile).toContain('--compile');
      expect(parsed.scripts.upload).toContain('--upload');
    });
  });

  describe("generateProjectTsconfig", () => {
    it("produces valid JSON with noEmit and paths", () => {
      const content = generateProjectTsconfig(ARDUINO_UNO_OPTIONS);
      const parsed = JSON.parse(content);

      expect(parsed.compilerOptions.noEmit).toBe(true);
      expect(parsed.compilerOptions.strict).toBe(true);
      expect(parsed.compilerOptions.paths['@typehal']).toBeDefined();
      expect(parsed.compilerOptions.paths['@typehal/core']).toBeDefined();
      expect(parsed.include).toContain('src/**/*.ts');
    });
  });

  describe("generateProjectConfig", () => {
    it("contains board, framework, and fqbn", () => {
      const content = generateProjectConfig(ARDUINO_UNO_OPTIONS);

      expect(content).toContain("target: 'avr'");
      expect(content).toContain("board: '@typehal/board-arduino-uno'");
      expect(content).toContain("framework: '@typehal/framework-arduino'");
      expect(content).toContain("fqbn: 'arduino:avr:uno'");
      expect(content).toContain("baudRate: 9600");
    });

    it("uses avr framework when specified", () => {
      const avrOptions: InitProjectOptions = {
        ...ARDUINO_UNO_OPTIONS,
        framework: 'avr',
        frameworkPackage: '@typehal/framework-avr',
      };
      const content = generateProjectConfig(avrOptions);

      expect(content).toContain("framework: '@typehal/framework-avr'");
      expect(content).toContain("framework: 'avr'");
    });
  });

  describe("generateProjectEnvDts", () => {
    it("declares the @typehal module and ownership types", () => {
      const content = generateProjectEnvDts(ARDUINO_UNO_OPTIONS);

      expect(content).toContain("declare module '@typehal'");
      expect(content).toContain("export * from '@typehal/board-arduino-uno'");
      expect(content).toContain("type Owned<T = any> = T");
      expect(content).toContain("type Ref<T = any> = T");
      expect(content).toContain("type MutRef<T = any> = T");
    });
  });

  describe("generateStarterSketch", () => {
    it("produces a blink sketch using LED and delay", () => {
      const content = generateStarterSketch(ARDUINO_UNO_OPTIONS);

      expect(content).toContain("import { LED, delay } from '@typehal'");
      expect(content).toContain("LED.asOutput");
      expect(content).toContain("led.toggle()");
      expect(content).toContain("delay(1000)");
    });
  });

  describe("generateGitignore", () => {
    it("includes node_modules and out directories", () => {
      const content = generateGitignore(ARDUINO_UNO_OPTIONS);

      expect(content).toContain("node_modules/");
      expect(content).toContain("out/");
    });
  });
});

// ---------------------------------------------------------------------------
// Scaffold orchestration tests
// ---------------------------------------------------------------------------

describe("init-scaffold", () => {
  describe("normalizeProjectName", () => {
    it("lowercases and hyphenates", () => {
      expect(normalizeProjectName("My Project")).toBe("my-project");
      expect(normalizeProjectName("hello_world")).toBe("hello-world");
      expect(normalizeProjectName("CamelCase")).toBe("camelcase");
    });

    it("removes invalid characters", () => {
      expect(normalizeProjectName("my@project!")).toBe("myproject");
      expect(normalizeProjectName("foo.bar")).toBe("foobar");
    });

    it("collapses multiple hyphens", () => {
      expect(normalizeProjectName("a---b")).toBe("a-b");
    });

    it("strips leading/trailing hyphens", () => {
      expect(normalizeProjectName("-hello-")).toBe("hello");
    });
  });

  describe("KNOWN_BOARDS", () => {
    it("contains arduino-uno", () => {
      const uno = KNOWN_BOARDS.find(b => b.id === 'arduino-uno');
      expect(uno).toBeDefined();
      expect(uno!.architecture).toBe('avr');
      expect(uno!.fqbn).toBe('arduino:avr:uno');
    });
  });

  describe("scaffoldProject", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typehal-init-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("creates all expected files with sketch", () => {
      const result = scaffoldProject(ARDUINO_UNO_OPTIONS, tmpDir);

      // Check all expected files exist
      const fileNames = result.createdFiles.map(f => path.basename(f));
      expect(fileNames).toContain('package.json');
      expect(fileNames).toContain('tsconfig.json');
      expect(fileNames).toContain('typehal.config.ts');
      expect(fileNames).toContain('typehal-env.d.ts');
      expect(fileNames).toContain('.gitignore');
      expect(fileNames).toContain('sketch.ts');

      // Verify src directory was created
      expect(fs.existsSync(path.join(tmpDir, 'src'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'src', 'sketch.ts'))).toBe(true);
    });

    it("creates all expected files without sketch", () => {
      const noSketchOptions = { ...ARDUINO_UNO_OPTIONS, includeSketch: false };
      const result = scaffoldProject(noSketchOptions, tmpDir);

      const fileNames = result.createdFiles.map(f => path.basename(f));
      expect(fileNames).toContain('package.json');
      expect(fileNames).toContain('tsconfig.json');
      expect(fileNames).not.toContain('sketch.ts');
    });

    it("throws if directory exists and is not empty", () => {
      // Create a file in the temp dir to make it non-empty
      fs.writeFileSync(path.join(tmpDir, 'existing.txt'), 'test');

      expect(() => scaffoldProject(ARDUINO_UNO_OPTIONS, tmpDir)).toThrow(
        /already exists and is not empty/,
      );
    });

    it("succeeds if directory exists but is empty", () => {
      // tmpDir is empty by default
      const result = scaffoldProject(ARDUINO_UNO_OPTIONS, tmpDir);
      expect(result.createdFiles.length).toBeGreaterThan(0);
    });

    it("returns resolved options", () => {
      const result = scaffoldProject(ARDUINO_UNO_OPTIONS, tmpDir);

      expect(result.outDir).toBe(tmpDir);
      expect(result.options.projectName).toBe('test-project');
      expect(result.options.boardId).toBe('arduino-uno');
    });

    it("generates valid JSON in package.json", () => {
      scaffoldProject(ARDUINO_UNO_OPTIONS, tmpDir);

      const pkgPath = path.join(tmpDir, 'package.json');
      const content = fs.readFileSync(pkgPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.name).toBe('test-project');
      expect(parsed.dependencies['@typehal/board-arduino-uno']).toBeDefined();
    });

    it("generates valid JSON in tsconfig.json", () => {
      scaffoldProject(ARDUINO_UNO_OPTIONS, tmpDir);

      const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
      const content = fs.readFileSync(tsconfigPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.compilerOptions.noEmit).toBe(true);
    });
  });
});
