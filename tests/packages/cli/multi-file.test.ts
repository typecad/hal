import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { transpileFile } from "../../../packages/cli/src/transpile";
import { buildProgramIR } from "../../../packages/cli/src/ir/build-ir";
import { detectExportedEntryPoints } from "../../../packages/cli/src/ir/entry-points";

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
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
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
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
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
    expect(libCpp).toContain("int used()");
    expect(libCpp).not.toContain("notUsed()");
  });

  it("preserves classes imported by the entry file", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
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
    const shapesCpp = fs.readFileSync(path.join(outDir, "shapes.cpp"), "utf8");

    // Point class should survive tree-shaking
    expect(shapesCpp).toContain("Point");
  });

  it("preserves enums imported by the entry file", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
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
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
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
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
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
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
    tempDirs.push(workspaceDir);

    const buttonPath = path.join(workspaceDir, "Button.ts");
    const entryPath = path.join(workspaceDir, "main.ts");

    fs.writeFileSync(
      buttonPath,
      [
        "import { D2, millis } from '@typecode';",
        "import type { IInputModePin } from '@typecode/core';",
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
        "import { D2 } from '@typecode';",
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
      emitMaps: false,
      skipTypeCheck: true,
    });

    const outDir = path.dirname(result.sourcePath);
    const sketchText = fs.readFileSync(result.sourcePath, "utf8");
    const buttonHeader = fs.readFileSync(path.join(outDir, "Button.h"), "utf8");

    expect(sketchText).toContain("void main_isr_0()");
    expect(buttonHeader).toContain("void Button_isr_0()");
    expect(sketchText).not.toContain("void isr_0()");
    expect(buttonHeader).not.toContain("void isr_0()");
  });

  it("emits valid C++ for standalone cross-module fluent API calls", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
    tempDirs.push(workspaceDir);

    const entryPath = path.join(workspaceDir, "sketch.ts");
    const buttonPath = path.join(workspaceDir, "Button.ts");

    fs.writeFileSync(
      buttonPath,
      [
        "export class Button {",
        "  static start(pin: number, debounceMs: number): Button {",
        "    return null as any;",
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
        "import { D2 } from '@typecode';",
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
      emitMaps: false,
      skipTypeCheck: true,
    });

    const sketchText = fs.readFileSync(result.sourcePath, "utf8");
    expect(sketchText).toContain("Button::start(2, 50)->onPress");
    expect(sketchText).not.toContain("Button.start(2, 50).onPress");
  });
});

// ---------------------------------------------------------------------------
// #pragma once guards
// ---------------------------------------------------------------------------
describe("header guards", () => {
  it("emits #pragma once in every generated header", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecode-"));
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
