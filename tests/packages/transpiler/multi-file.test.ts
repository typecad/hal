import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { transpileFile, buildProgramIR, detectExportedEntryPoints } from "../../../packages/cuttlefish/src/testing";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dirPath of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// detectExportedEntryPoints (unit tests)
// ---------------------------------------------------------------------------
describe("detectExportedEntryPoints", () => {
  it("marks exported functions that are imported by other files", () => {
    const source = `
      export function helper(): void { console.log("help"); }
      export function unused(): void { console.log("unused"); }
    `;
    const program = buildProgramIR("lib.ts", source);
    const entryPoints = detectExportedEntryPoints(program, new Set(["helper"]));
    expect(entryPoints.has("helper")).toBe(true);
    expect(entryPoints.has("unused")).toBe(false);
  });

  it("marks exported classes that are imported by other files", () => {
    const source = `
      export class Sensor { public value: number = 0; }
      export class UnusedClass { public x: number = 1; }
    `;
    const program = buildProgramIR("lib.ts", source);
    const entryPoints = detectExportedEntryPoints(program, new Set(["Sensor"]));
    expect(entryPoints.has("Sensor")).toBe(true);
    expect(entryPoints.has("UnusedClass")).toBe(false);
  });

  it("marks exported enums that are imported by other files", () => {
    const source = `
      export enum Color { Red, Green, Blue }
      export enum UnusedEnum { A, B }
    `;
    const program = buildProgramIR("lib.ts", source);
    const entryPoints = detectExportedEntryPoints(program, new Set(["Color"]));
    expect(entryPoints.has("Color")).toBe(true);
    expect(entryPoints.has("UnusedEnum")).toBe(false);
  });

  it("returns empty set when no symbols are imported", () => {
    const source = `
      export function foo(): void {}
    `;
    const program = buildProgramIR("lib.ts", source);
    const entryPoints = detectExportedEntryPoints(program, new Set());
    expect(entryPoints.size).toBe(0);
  });

  it("ignores symbols not defined in the program", () => {
    const source = `
      export function foo(): void {}
    `;
    const program = buildProgramIR("lib.ts", source);
    const entryPoints = detectExportedEntryPoints(program, new Set(["nonexistent"]));
    expect(entryPoints.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Topological sort (integration via transpileFile)
// ---------------------------------------------------------------------------
describe("topological sort", () => {
  it("emits dependency files before dependent files in a three-file chain", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    // A → B → C  (A imports B, B imports C)
    const cPath = path.join(workspaceDir, "c.ts");
    const bPath = path.join(workspaceDir, "b.ts");
    const aPath = path.join(workspaceDir, "a.ts");

    fs.writeFileSync(
      cPath,
      [
        "export function cVal(): number { return 42; }",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      bPath,
      [
        'import { cVal } from "./c";',
        "",
        "export function bVal(): number { return cVal() + 1; }",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      aPath,
      [
        'import { bVal } from "./b";',
        "",
        "export function main(): void {",
        "  console.log(bVal());",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: aPath,
      emitMode: "split",
      target: "generic",
      emitMaps: false,
    });

    const outDir = path.join(workspaceDir, ".build");

    // All three output files should exist
    expect(fs.existsSync(path.join(outDir, "c.cpp"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "c.h"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "b.cpp"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "b.h"))).toBe(true);
    expect(fs.existsSync(result.sourcePath)).toBe(true);

    // b.cpp should include c.h
    const bCpp = fs.readFileSync(path.join(outDir, "b.cpp"), "utf8");
    expect(bCpp).toContain('#include "c.h"');

    // a.cpp should include b.h
    const aCpp = fs.readFileSync(result.sourcePath, "utf8");
    expect(aCpp).toContain('#include "b.h"');
  });
});

// ---------------------------------------------------------------------------
// Cross-module tree-shaking
// ---------------------------------------------------------------------------
describe("cross-module tree-shaking", () => {
  it("preserves functions imported by the entry file", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const libPath = path.join(workspaceDir, "lib.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    // lib exports two functions, but only `used` is imported
    fs.writeFileSync(
      libPath,
      [
        "export function used(): number { return 1; }",
        "export function notUsed(): number { return 2; }",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      entryPath,
      [
        'import { used } from "./lib";',
        "",
        "export function main(): void {",
        "  console.log(used());",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "generic",
      emitMaps: false,
    });

    const outDir = path.join(workspaceDir, ".build");
    const libCpp = fs.readFileSync(path.join(outDir, "lib.cpp"), "utf8");

    // `used` should survive tree-shaking because it's imported by main.ts
    expect(libCpp).toContain("double used()");
    expect(libCpp).not.toContain("notUsed()");
  });

    // A class imported by the entry file is preserved by cross-module tree-
    // shaking. In split mode a class with only field initializers (no methods
    // requiring out-of-line bodies) is emitted entirely in the header, so the
    // correctness invariant is checked against `shapes.h` (the sibling enum
    // test below follows the same convention).
    it("preserves classes imported by the entry file", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const libPath = path.join(workspaceDir, "shapes.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(
      libPath,
      [
        "export class Point {",
        "  public x: number = 0;",
        "  public y: number = 0;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      entryPath,
      [
        'import { Point } from "./shapes";',
        "",
        "export function main(): void {",
        "  const p = new Point();",
        "  console.log(p.x);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "generic",
      emitMaps: false,
    });

    const outDir = path.join(workspaceDir, ".build");
    const shapesH = fs.readFileSync(path.join(outDir, "shapes.h"), "utf8");

    // Point class should survive tree-shaking. The class body (fields only,
    // no methods) is emitted in the header in split mode.
    expect(shapesH).toContain("class Point");
  });

  it("preserves enums imported by the entry file", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const libPath = path.join(workspaceDir, "types.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(
      libPath,
      [
        "export enum Status { Active, Inactive }",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      entryPath,
      [
        'import { Status } from "./types";',
        "",
        "export function main(): void {",
        "  const s: Status = Status.Active;",
        "  console.log(s);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "generic",
      emitMaps: false,
    });

    const outDir = path.join(workspaceDir, ".build");
    // Enums are emitted in the header file in split mode
    const typesHeader = fs.readFileSync(path.join(outDir, "types.h"), "utf8");

    // Status enum should survive tree-shaking
    expect(typesHeader).toContain("Status");
  });
});

// ---------------------------------------------------------------------------
// Forward declarations
// ---------------------------------------------------------------------------
describe("forward declarations", () => {
  it("emits forward declarations for cross-module class types in headers", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const libPath = path.join(workspaceDir, "sensor.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(
      libPath,
      [
        "export class Sensor {",
        "  public reading: number = 0;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      entryPath,
      [
        'import { Sensor } from "./sensor";',
        "",
        "export function main(): void {",
        "  const s = new Sensor();",
        "  console.log(s.reading);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "generic",
      emitMaps: false,
    });

    const outDir = path.join(workspaceDir, ".build");

    // The entry file's header should have a forward declaration for Sensor
    // since Sensor is defined in another module
    const mainHeader = fs.readFileSync(path.join(outDir, "main.h"), "utf8");
    expect(mainHeader).toContain("class Sensor;");
  });

  it("does not duplicate forward declarations for classes defined in the same file", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const libPath = path.join(workspaceDir, "local.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(
      libPath,
      [
        "export class Local {",
        "  public x: number = 0;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      entryPath,
      [
        "class Internal {",
        "  public y: number = 1;",
        "}",
        "",
        "export function main(): void {",
        "  const i = new Internal();",
        "  console.log(i.y);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "generic",
      emitMaps: false,
    });

    const outDir = path.join(workspaceDir, ".build");
    const mainHeader = fs.readFileSync(path.join(outDir, "main.h"), "utf8");

    // Internal is defined in main.ts itself — the emitter forward-declares all
    // local classes, so `class Internal;` should appear exactly once (not duplicated
    // by the cross-module forward declaration logic).
    const matches = mainHeader.match(/class Internal;/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("emits unique callback names for entry and imported Arduino modules", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const buttonPath = path.join(workspaceDir, "Button.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(
      buttonPath,
      [
        "import { D2, millis } from '@typecad';",
        "import type { IInputModePin } from '@typecad/simulator';",
        "",
        "export class Button {",
        "  private readonly pin: IInputModePin;",
        "  private readonly debounceMs: number;",
        "  private lastPress: number = 0;",
        "  private handler: (() => void) | null = null;",
        "",
        "  private constructor(pin: IInputModePin, debounceMs: number) {",
        "    this.pin = pin;",
        "    this.debounceMs = debounceMs;",
        "  }",
        "",
        "  static start(pin: { asInputPullUp(): IInputModePin; onFalling(handler: () => void): void }, debounceMs: number = 50): Button {",
        "    const input = pin.asInputPullUp();",
        "    const btn = new Button(input, debounceMs);",
        "    pin.onFalling(() => {",
        "      const now = millis();",
        "      if ((now - btn.lastPress) >= btn.debounceMs) {",
        "        btn.lastPress = now;",
        "        if (btn.handler !== null) {",
        "          btn.handler();",
        "        }",
        "      }",
        "    });",
        "    return btn;",
        "  }",
        "",
        "  onPress(handler: () => void): this {",
        "    this.handler = handler;",
        "    return this;",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      entryPath,
      [
        "import { D2 } from '@typecad';",
        "import { Button } from './Button';",
        "",
        "const btn = Button.start(D2, 50).onPress(() => {",
        "  // noop",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "arduino",
      mcu: "@typecad/mcu-atmega328p",
      emitMaps: false,
      skipTypeCheck: true,
    });

    const outDir = path.dirname(result.sourcePath);
    const sketchText = fs.readFileSync(result.sourcePath, "utf8");
    const buttonHeader = fs.readFileSync(path.join(outDir, "Button.h"), "utf8");

    // ISR from Button.ts onFalling() gets module-prefixed name
    expect(buttonHeader).toContain("void Button_isr_0()");
    // Neither file should have unprefixed ISR names
    expect(sketchText).not.toContain("void isr_0()");
    expect(buttonHeader).not.toContain("void isr_0()");
  });

  it("emits valid C++ for standalone cross-module fluent API calls", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const entryPath = path.join(workspaceDir, "sketch.ts");
    const buttonPath = path.join(workspaceDir, "Button.ts");

    fs.writeFileSync(
      buttonPath,
      [
        "export class Button {",
        "  static start(pin: number, debounceMs: number): Button {",
        "    return new Button();",
        "  }",
        "",
        "  onPress(handler: () => void): this {",
        "    return this;",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      entryPath,
      [
        "import { D2 } from '@typecad';",
        "import { Button } from './Button';",
        "",
        "Button.start(D2, 50).onPress(() => {",
        "  // noop",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "arduino",
      mcu: "@typecad/mcu-atmega328p",
      emitMaps: false,
      skipTypeCheck: true,
    });

    const sketchText = fs.readFileSync(result.sourcePath, "utf8");
    expect(sketchText).toContain("Button::start(2, 50)->onPress");
    expect(sketchText).not.toContain("Button.start(2, 50).onPress");
  });

  // Demo #18 Finding B: split mode now emits a non-static forward declaration
  // for a free function called from an inline class method body into the
  // HEADER (ahead of the class definition), so the method can see the symbol.
  // Previously the only forward decl was `static` in the .cpp, emitted after
  // `#include "main.h"`, so the inline method body failed with
  // "'helper' was not declared in this scope".
  it("emits free function forward declarations before class definitions in split mode", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(
      entryPath,
      [
        "function helper(x: number): number { return x + 1; }",
        "",
        "class Processor {",
        "  public process(val: number): number {",
        "    return helper(val);",
        "  }",
        "}",
        "",
        "export function main(): void {",
        "  const p = new Processor();",
        "  console.log(p.process(42));",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "generic",
      emitMaps: false,
    });

    const outDir = path.join(workspaceDir, ".build");
    const mainHeader = fs.readFileSync(path.join(outDir, "main.h"), "utf8");

    // `number` lowers to `double`, so the forward declaration is
    // `double helper(double x);`. It must appear BEFORE the class definition.
    const declIdx = mainHeader.indexOf("helper(double");
    const classIdx = mainHeader.indexOf("class Processor {");
    expect(declIdx).toBeGreaterThanOrEqual(0);
    expect(classIdx).toBeGreaterThanOrEqual(0);
    expect(declIdx).toBeLessThan(classIdx);
  });
});

describe("cross-module string interpolation", () => {
  it("uses field and function return types instead of std::to_string heuristics", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const statePath = path.join(workspaceDir, "State.ts");
    const namesPath = path.join(workspaceDir, "names.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(statePath, [
      'export class Player { name: string = "Ada"; level: number = 3; }',
      'export class State { player: Player = new Player(); }',
      '',
    ].join("\n"), "utf8");
    fs.writeFileSync(namesPath, [
      'export function getTitle(): string { return "captain"; }',
      '',
    ].join("\n"), "utf8");
    fs.writeFileSync(entryPath, [
      'import { State } from "./State";',
      'import { getTitle } from "./names";',
      '',
      'export function summary(s: State): string {',
      '  return `${s.player.name} level ${s.player.level} ${getTitle()}`;',
      '}',
      'console.log(summary(new State()));',
      '',
    ].join("\n"), "utf8");

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "native",
      emitMaps: false,
      skipTypeCheck: true,
    });

    const cpp = [result.sourcePath, result.headerPath]
      .filter((filePath): filePath is string => !!filePath && fs.existsSync(filePath))
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("\n");
    expect(cpp).toContain("s->player->name");
    expect(cpp).not.toContain("std::to_string(s->player->name)");
    expect(cpp).toMatch(/snprintf\([^;]*s->player->level/);
    expect(cpp).toContain("getTitle()");
    expect(cpp).not.toContain("std::to_string(getTitle())");
  });

  it("does not classify imported PascalCase interfaces as classes", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const configPath = path.join(workspaceDir, "Config.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(configPath, [
      "export interface Config { count: number; }",
      "",
    ].join("\n"), "utf8");
    fs.writeFileSync(entryPath, [
      'import { Config } from "./Config";',
      "export function read(config: Config): number { return config.count; }",
      "const config: Config = { count: 1 };",
      "console.log(read(config));",
      "",
    ].join("\n"), "utf8");

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "native",
      emitMaps: false,
      skipTypeCheck: true,
    });

    const cpp = [result.sourcePath, result.headerPath]
      .filter((filePath): filePath is string => !!filePath && fs.existsSync(filePath))
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("\n");
    expect(cpp).toContain("read(const Config& config)");
    expect(cpp).not.toContain("read(Config* config)");
  });
});

// ---------------------------------------------------------------------------
// #pragma once guards
// ---------------------------------------------------------------------------
describe("header guards", () => {
  it("emits #pragma once in every generated header", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const libPath = path.join(workspaceDir, "util.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(
      libPath,
      [
        "export function util(): void { console.log(\"util\"); }",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      entryPath,
      [
        'import { util } from "./util";',
        "",
        "export function main(): void {",
        "  util();",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "generic",
      emitMaps: false,
    });

    const outDir = path.join(workspaceDir, ".build");

    const utilHeader = fs.readFileSync(path.join(outDir, "util.h"), "utf8");
    const mainHeader = fs.readFileSync(path.join(outDir, "main.h"), "utf8");

    expect(utilHeader).toContain("#pragma once");
    expect(mainHeader).toContain("#pragma once");
  });
});

// ---------------------------------------------------------------------------
// Cross-module variable types
// ---------------------------------------------------------------------------
describe("cross-module variable types", () => {
  it("uses concrete type in header for exported string constant", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const libPath = path.join(workspaceDir, "lib.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(
      libPath,
      [
        'export const GREETING = "hello";',
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      entryPath,
      [
        'import { GREETING } from "./lib";',
        "",
        "export function main(): void {",
        '  console.log(GREETING);',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "generic",
      emitMaps: false,
    });

    const outDir = path.join(workspaceDir, ".build");
    const libHeader = fs.readFileSync(path.join(outDir, "lib.h"), "utf8");

    expect(libHeader).toContain("extern const std::string GREETING");
    expect(libHeader).not.toContain("extern const auto GREETING");
  });

  it("uses concrete type in header for exported number constant", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const libPath = path.join(workspaceDir, "lib.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(
      libPath,
      [
        "export const COUNT = 42;",
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      entryPath,
      [
        'import { COUNT } from "./lib";',
        "",
        "export function main(): void {",
        "  console.log(COUNT);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "generic",
      emitMaps: false,
    });

    const outDir = path.join(workspaceDir, ".build");
    const libHeader = fs.readFileSync(path.join(outDir, "lib.h"), "utf8");

    expect(libHeader).toContain("extern const int COUNT");
    expect(libHeader).not.toContain("extern const auto COUNT");
  });

  it("does not emit std::to_string for imported string constants in snprintf mode", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-"));
    tempDirs.push(workspaceDir);

    const libPath = path.join(workspaceDir, "lib.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(
      libPath,
      [
        'export const MISSION_NAME = "Voyager";',
        "",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      entryPath,
      [
        'import { MISSION_NAME } from "./lib";',
        "",
        "export function main(): void {",
        "  console.log(`Mission: ${MISSION_NAME}`);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await transpileFile({
      inputFile: entryPath,
      emitMode: "split",
      target: "arduino",
      emitMaps: false,
    });

    const mainCpp = fs.readFileSync(result.sourcePath, "utf8");

    expect(mainCpp).not.toContain("std::to_string(MISSION_NAME)");
    expect(mainCpp).not.toContain("String(MISSION_NAME)");
  });
});
