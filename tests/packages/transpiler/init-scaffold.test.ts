// ---------------------------------------------------------------------------
// Tests for `cuttlefish init` project scaffolding
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  scaffoldProject,
  normalizeProjectName,
  KNOWN_BOARDS,
  generateProjectPackageJson,
  generateProjectTsconfig,
  generateProjectConfig,
  generateProjectEnvDts,
  generateStarterSketch,
  generateStarterTest,
  generateStarterSim,
  generateGitignore,
  generateEslintConfig,
} from "@typecad/cuttlefish/testing";
import type { InitProjectOptions } from "@typecad/cuttlefish/testing";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ARDUINO_UNO_OPTIONS: InitProjectOptions = {
  projectName: 'test-project',
  targetId: 'arduino-uno',
  boardId: 'arduino-uno',
  boardDisplayName: 'Arduino Uno',
  architecture: 'avr',
  boardPackage: '@typecad/board-arduino-uno',
  frameworkPackage: '@typecad/framework-arduino',
  framework: 'arduino',
  buildTarget: 'arduino:avr:uno',
  mcu: 'atmega328p',
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
      // Deps must pin the current @typecad/* release line (1.0.0-alpha.x), not a
      // stale 0.1.0-alpha.x. Older pins let npm resolve incompatible registry
      // builds that break at runtime (e.g. `npm run simulate` against an older
      // @typecad/hal whose module layout no longer matches @typecad/simulator).
      expect(parsed.dependencies['@typecad/cuttlefish']).toBe('^1.0.0-alpha.3');
      expect(parsed.dependencies['@typecad/board-arduino-uno']).toBe('^1.0.0-alpha.3');
      expect(parsed.dependencies['@typecad/framework-arduino']).toBe('^1.0.0-alpha.3');
      expect(parsed.scripts.build).toContain('cuttlefish');
      expect(parsed.scripts.compile).toContain('--compile');
      expect(parsed.scripts.upload).toContain('--upload');
    });

    it("adds a hardware test setup for embedded targets", () => {
      // Embedded scaffolds get the @typecad/expect framework and a test:hw
      // script that runs cuttlefish-test (transpile → flash → serial evaluate).
      const content = generateProjectPackageJson(ARDUINO_UNO_OPTIONS);
      const parsed = JSON.parse(content);

      expect(parsed.scripts['test:hw']).toBe('npm exec -- cuttlefish-test');
      expect(parsed.devDependencies['@typecad/expect']).toBeDefined();
    });

    it("adds a host-side simulation setup for embedded targets", () => {
      // Embedded scaffolds also get @typecad/simulator + vitest, run via
      // `npm run simulate` (scoped to sim/ so it never collides with the
      // @typecad/expect tests under tests/).
      const content = generateProjectPackageJson(ARDUINO_UNO_OPTIONS);
      const parsed = JSON.parse(content);

      expect(parsed.scripts['simulate']).toBe('vitest run sim/');
      expect(parsed.devDependencies['@typecad/simulator']).toBeDefined();
      expect(parsed.devDependencies['vitest']).toBeDefined();
    });

    it("omits both test tiers for native targets", () => {
      // Native (g++/clang++) has no serial/board path, so it gets no test:hw
      // script and no @typecad/expect dependency. It also has no MCU
      // peripherals to simulate, so it gets no simulate script / simulator dep.
      const nativeOptions: InitProjectOptions = {
        projectName: 'native-project',
        targetId: 'native',
        targetDisplayName: 'Native Desktop',
        isNative: true,
        frameworkPackage: '@typecad/framework-native',
        framework: 'native',
        includeSketch: true,
      };
      const content = generateProjectPackageJson(nativeOptions);
      const parsed = JSON.parse(content);

      expect(parsed.scripts['test:hw']).toBeUndefined();
      expect(parsed.devDependencies['@typecad/expect']).toBeUndefined();
      expect(parsed.scripts['simulate']).toBeUndefined();
      expect(parsed.devDependencies['@typecad/simulator']).toBeUndefined();
    });

    it("includes @typecad/hal for every target (transpiler loads it unconditionally)", () => {
      // Regression: the transpiler warms @typecad/hal on EVERY build
      // (loadHALModules in transpile.ts), and resolveHALSourceDir() throws
      // "Could not resolve @typecad/hal/src/" if the package is missing. Native
      // projects have no board package and @typecad/framework-native does not
      // declare HAL transitively, so without an explicit dep the first
      // `cuttlefish build` after `cuttlefish create` fails. Embedded targets
      // already pulled it in via framework-arduino + board packages, but the
      // scaffold lists it directly so every target is covered.
      const nativeOptions: InitProjectOptions = {
        projectName: 'native-project',
        targetId: 'native',
        targetDisplayName: 'Native Desktop',
        isNative: true,
        frameworkPackage: '@typecad/framework-native',
        framework: 'native',
        includeSketch: true,
      };
      for (const opts of [ARDUINO_UNO_OPTIONS, nativeOptions]) {
        const parsed = JSON.parse(generateProjectPackageJson(opts));
        expect(parsed.dependencies['@typecad/hal']).toBe('^1.0.0-alpha.3');
      }
    });

    it("adds dev/gen-decls/gen-libdefs scripts to every target", () => {
      // These developer-utility scripts are target-agnostic (no hardware, no
      // extra deps): watch mode for the edit→transpile loop, and the two
      // C++-interop codegen commands. They must appear on both native and
      // embedded scaffolds.
      const nativeOptions: InitProjectOptions = {
        projectName: 'native-project',
        targetId: 'native',
        targetDisplayName: 'Native Desktop',
        isNative: true,
        frameworkPackage: '@typecad/framework-native',
        framework: 'native',
        includeSketch: true,
      };
      for (const opts of [ARDUINO_UNO_OPTIONS, nativeOptions]) {
        const parsed = JSON.parse(generateProjectPackageJson(opts));
        expect(parsed.scripts['dev']).toBe('cuttlefish build --watch');
        expect(parsed.scripts['gen-decls']).toBe('cuttlefish gen-decls');
        expect(parsed.scripts['gen-libdefs']).toBe('cuttlefish gen-libdefs');
      }
    });
  });

  describe("generateProjectTsconfig", () => {
    it("produces valid JSON with noEmit and paths", () => {
      const content = generateProjectTsconfig(ARDUINO_UNO_OPTIONS);
      const parsed = JSON.parse(content);

      expect(parsed.compilerOptions.noEmit).toBe(true);
      expect(parsed.compilerOptions.strict).toBe(true);
      expect(parsed.compilerOptions.paths['@typecad/board']).toBeDefined();
      expect(parsed.compilerOptions.allowArbitraryExtensions).toBe(true);
      expect(parsed.compilerOptions.allowImportingTsExtensions).toBe(true);
      expect(parsed.compilerOptions.rootDirs).toEqual(["src", "types"]);
      expect(parsed.include).toContain('src/**/*.ts');
      expect(parsed.include).toContain('types/**/*.ts');
      expect(parsed.include).toContain('sim/**/*.ts');
    });

    it("omits 'dom' from lib (console typings come from cuttlefish-env.d.ts)", () => {
      // Demo #25 Finding B — shipping lib.dom pulls in DOM global type names
      // (Node, Element, Event, ...) that shadow user classes of the same name.
      // The scaffolded project must not include "dom" in lib; the console
      // global is declared in cuttlefish-env.d.ts instead.
      const content = generateProjectTsconfig(ARDUINO_UNO_OPTIONS);
      const parsed = JSON.parse(content);

      expect(parsed.compilerOptions.lib).toBeDefined();
      expect(parsed.compilerOptions.lib).not.toContain('dom');
      expect(parsed.compilerOptions.lib).toContain('ES2022');
    });

    it("includes the cuttlefish-env.d.ts global declarations for every target", () => {
      // Regression: the env .d.ts declares the `console` global (plus
      // SafeVariable, timers, cstdint aliases, ...) so projects do not need
      // "dom" in lib to type console.log. It is generated for ALL targets, so it
      // must appear in tsconfig#include for both native and embedded — otherwise
      // VSCode's TS server never loads it and reports "Cannot find name
      // 'console'" on every console call. Native projects were previously left
      // out because the include entry was gated on boardPackage being set.
      const nativeOptions: InitProjectOptions = {
        projectName: 'native-project',
        targetId: 'native',
        targetDisplayName: 'Native Desktop',
        isNative: true,
        frameworkPackage: '@typecad/framework-native',
        framework: 'native',
        includeSketch: true,
      };
      for (const opts of [ARDUINO_UNO_OPTIONS, nativeOptions]) {
        const parsed = JSON.parse(generateProjectTsconfig(opts));
        expect(parsed.include).toContain('.cuttlefish/cuttlefish-env.d.ts');
      }
    });

    it("does NOT enable noUncheckedIndexedAccess (dense-array target)", () => {
      // Demo #26 — this transpiler targets dense storage (std::vector built by
      // push_back / array literals, never sparse), and idiomatic array code
      // uses indices bounded by `.length` by construction. noUncheckedIndexedAccess
      // forces an unverified `arr[i]!` assertion on every index read without
      // catching real OOB (the assertion is unchecked), so it adds friction with
      // ~zero safety payoff here. The flag is left off the scaffold; `strict`
      // + `strictNullChecks` are kept, so genuine null/undefined holes are still
      // caught. Projects that want the stricter mode can re-enable it locally.
      const content = generateProjectTsconfig(ARDUINO_UNO_OPTIONS);
      const parsed = JSON.parse(content);

      expect(parsed.compilerOptions.strict).toBe(true);
      expect(parsed.compilerOptions.strictNullChecks).toBe(true);
      expect(parsed.compilerOptions.noUncheckedIndexedAccess).toBeFalsy();
    });
  });

  describe("generateProjectConfig", () => {
    it("contains board, framework, and fqbn", () => {
      const content = generateProjectConfig(ARDUINO_UNO_OPTIONS);

      expect(content).toContain("target: 'avr'");
      expect(content).toContain("board: '@typecad/board-arduino-uno'");
      expect(content).toContain("framework: '@typecad/framework-arduino'");
      expect(content).toContain("frameworkData:");
      expect(content).toContain("buildTarget: 'arduino:avr:uno'");
      expect(content).toContain("baudRate: 9600");
    });

    it("expands the esp32s3 registry mcu to @typecad/mcu-esp32s3", () => {
      // Regression: the esp32s3 registry entry carries `mcu: 'esp32s3'`, which
      // the template wraps as `@typecad/mcu-${mcu}`. An earlier value of
      // 'ESP32-S3' produced the broken '@typecad/mcu-ESP32-S3'. This test pins
      // the correct package specifier for the scaffolded config.
      const s3Target = KNOWN_BOARDS.find(t => t.id === 'esp32s3');
      expect(s3Target).toBeDefined();
      const s3Options: InitProjectOptions = {
        projectName: 'test-project',
        boardId: s3Target!.id,
        boardDisplayName: s3Target!.displayName,
        architecture: s3Target!.architecture!,
        boardPackage: s3Target!.boardPackage!,
        // KNOWN_TARGETS board entries no longer hardcode a framework (the
        // scaffold wizard discovers it). Supply Arduino explicitly here, as a
        // real scaffold would after the wizard picks it.
        frameworkPackage: '@typecad/framework-arduino',
        framework: 'arduino',
        buildTarget: s3Target!.buildTarget!,
        mcu: s3Target!.mcu!,
        baudRate: 115200,
        includeSketch: true,
      };
      const content = generateProjectConfig(s3Options);

      expect(content).toContain("target: 'esp32s3'");
      expect(content).toContain("mcu: '@typecad/mcu-esp32s3'");
      expect(content).toContain("board: '@typecad/board-esp32s3'");
      expect(content).toContain("buildTarget: 'esp32:esp32:esp32s3'");
    });

    it("includes a hardware test section for embedded targets", () => {
      // The test: block wires cuttlefish-test discovery (include glob) and the
      // serial port the runner flashes/reads. Required for `npm run test:hw`.
      const content = generateProjectConfig(ARDUINO_UNO_OPTIONS);

      expect(content).toContain('test: {');
      expect(content).toContain("include: ['tests/**/*.test.ts']");
      expect(content).toContain('port:');
      expect(content).toContain('baudRate: 9600');
    });
  });

  describe("generateProjectEnvDts", () => {
    it("declares the @typecad/board module and ownership types", () => {
      const content = generateProjectEnvDts(ARDUINO_UNO_OPTIONS);

      expect(content).toContain("declare module '@typecad/board'");
      expect(content).toContain("export * from './board.js'");
      expect(content).toContain("type Owned<T = unknown> = T");
      expect(content).toContain("type Shared<T = unknown> = T");
      expect(content).toContain("type Mutable<T = unknown> = T");
    });

    it("declares the console global so lib.dom is not required (demo #25 Finding B)", () => {
      // Both the board-package and native branches must declare a `console`
      // value + Console interface so console.log types without lib.dom.
      const withBoard = generateProjectEnvDts(ARDUINO_UNO_OPTIONS);
      const native = generateProjectEnvDts({ ...ARDUINO_UNO_OPTIONS, boardPackage: undefined });

      for (const content of [withBoard, native]) {
        expect(content).toContain('interface Console');
        expect(content).toContain('log(...args: unknown[]): void');
        expect(content).toContain('const console: Console');
      }
    });
  });

  describe("generateStarterSketch", () => {
    it("produces a blink sketch using LED and delay", () => {
      const content = generateStarterSketch(ARDUINO_UNO_OPTIONS);

      expect(content).toContain("import { LED, delay } from '@typecad/board'");
      expect(content).toContain("LED.asOutput");
      expect(content).toContain("led.toggle()");
      expect(content).toContain("delay(1000)");
    });
  });

  describe("generateStarterTest", () => {
    it("produces a runnable @typecad/expect hardware test", () => {
      const content = generateStarterTest(ARDUINO_UNO_OPTIONS);

      // Must import the framework's describe/done entry points and end with done().
      expect(content).toContain("import { describe, done } from '@typecad/expect';");
      expect(content).toContain('done();');
      // Must demonstrate the fluent API: describe → it → expect → matcher.
      expect(content).toContain('describe(');
      expect(content).toContain('.it(');
      expect(content).toContain('.expect(');
      expect(content).toContain('.toBe(');
    });
  });

  describe("generateStarterSim", () => {
    it("produces a vitest + @typecad/simulator harness for the project's board", () => {
      const content = generateStarterSim(ARDUINO_UNO_OPTIONS);

      expect(content).toContain('from "vitest"');
      expect(content).toContain('from "@typecad/simulator"');
      // Builds a sim board mirroring the project's target id.
      expect(content).toContain('boardType: "arduino-uno"');
      expect(content).toContain('createSimBoard');
      // Demonstrates the vitest API + an injection-based assertion.
      expect(content).toContain('describe(');
      expect(content).toContain('it(');
      expect(content).toContain('injectValue');
      expect(content).toContain('expect(');
    });
  });

  describe("generateGitignore", () => {
    it("includes node_modules and out directories", () => {
      const content = generateGitignore(ARDUINO_UNO_OPTIONS);

      expect(content).toContain("node_modules/");
      expect(content).toContain("out/");
    });

    // Regression: the ESLint gate cache (lint-cache.ts) writes
    // .cuttlefish-cache.json at the project root. It must be gitignored so the
    // per-machine cache is never committed. Without this, a teammate's stale
    // cache could mask real lint violations.
    it("gitignores the .cuttlefish-cache.json gate cache file", () => {
      const content = generateGitignore(ARDUINO_UNO_OPTIONS);
      expect(content).toContain(".cuttlefish-cache.json");
    });
  });

  describe("generateEslintConfig", () => {
    // Regression: the scaffolded config must NOT set parserOptions.project.
    // None of the rules in the config (no-restricted-syntax, the cuttlefish/*
    // AST rules, no-explicit-any, no-eval, ...) consume type information, so
    // enabling type-aware linting only forces ESLint to build a full TS
    // type-program per file — ~3.4s of pure overhead on small projects with
    // zero change to what is detected (measured 135x slower, identical
    // violation set). If a future rule needs types, scope project to that rule
    // via a dedicated config block, not globally.
    it("does not enable type-aware parsing (no parserOptions.project)", () => {
      const content = generateEslintConfig(ARDUINO_UNO_OPTIONS);
      expect(content).not.toContain("project:");
      expect(content).not.toMatch(/parserOptions\s*:\s*\{/);
    });

    it("still registers the transpiler rules and AOT-safety rules", () => {
      const content = generateEslintConfig(ARDUINO_UNO_OPTIONS);
      // The rule surface that excludes non-AOT patterns must remain intact.
      expect(content).toContain('"no-restricted-syntax"');
      expect(content).toContain('"@typescript-eslint/no-explicit-any"');
      expect(content).toContain('"no-eval"');
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
      expect(uno!.buildTarget).toBe('arduino:avr:uno');
    });

    it("contains esp32s3", () => {
      const s3 = KNOWN_BOARDS.find(b => b.id === 'esp32s3');
      expect(s3).toBeDefined();
      expect(s3!.architecture).toBe('esp32s3');
      expect(s3!.buildTarget).toBe('esp32:esp32:esp32s3');
    });

    it("contains esp32c3", () => {
      const c3 = KNOWN_BOARDS.find(b => b.id === 'esp32c3');
      expect(c3).toBeDefined();
      expect(c3!.architecture).toBe('esp32c3');
      expect(c3!.buildTarget).toBe('esp32:esp32:esp32c3');
    });

    it("contains esp32c6", () => {
      const c6 = KNOWN_BOARDS.find(b => b.id === 'esp32c6');
      expect(c6).toBeDefined();
      expect(c6!.architecture).toBe('esp32c6');
      expect(c6!.buildTarget).toBe('esp32:esp32:esp32c6');
    });

    it("contains rp2040", () => {
      const b = KNOWN_BOARDS.find(b => b.id === 'rp2040');
      expect(b).toBeDefined();
      expect(b!.architecture).toBe('rp2040');
      expect(b!.buildTarget).toBe('rp2040:rp2040:rpipico');
    });

    it("contains rp2350", () => {
      const b = KNOWN_BOARDS.find(b => b.id === 'rp2350');
      expect(b).toBeDefined();
      expect(b!.architecture).toBe('rp2350');
      expect(b!.buildTarget).toBe('rp2040:rp2040:rpipico2');
    });
  });

  describe("scaffoldProject", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuttlefish-init-test-'));
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
      expect(fileNames).toContain('cuttlefish.config.ts');
      expect(fileNames).toContain('cuttlefish-env.d.ts');
      // Boilerplate files now live in .cuttlefish/ (not the project root)
      const dirPaths = result.createdFiles.map(f => f.replace(/\\/g, '/'));
      expect(dirPaths.some(f => f.endsWith('.cuttlefish/cuttlefish-env.d.ts'))).toBe(true);
      expect(dirPaths.some(f => f.endsWith('.cuttlefish/eslint.config.mjs'))).toBe(true);
      expect(dirPaths.some(f => f.endsWith('.cuttlefish/eslint-transpiler-rules.mjs'))).toBe(true);
      expect(fileNames).toContain('.gitignore');
      expect(fileNames).toContain('main.ts');

      // Verify src directory was created
      expect(fs.existsSync(path.join(tmpDir, 'src'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'src', 'main.ts'))).toBe(true);

      // Embedded projects get a starter hardware test + a host-side sim harness.
      expect(dirPaths.some(f => f.endsWith('tests/01-basics.test.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'tests', '01-basics.test.ts'))).toBe(true);
      expect(dirPaths.some(f => f.endsWith('sim/main.test.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'sim', 'main.test.ts'))).toBe(true);
    });

    it("creates all expected files without sketch", () => {
      const noSketchOptions = { ...ARDUINO_UNO_OPTIONS, includeSketch: false };
      const result = scaffoldProject(noSketchOptions, tmpDir);

      const fileNames = result.createdFiles.map(f => path.basename(f));
      expect(fileNames).toContain('package.json');
      expect(fileNames).toContain('tsconfig.json');
      expect(fileNames).not.toContain('main.ts');
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
      expect(parsed.dependencies['@typecad/board-arduino-uno']).toBeDefined();
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
