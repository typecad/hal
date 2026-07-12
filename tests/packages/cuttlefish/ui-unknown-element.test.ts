// ---------------------------------------------------------------------------
// ui-unknown-element diagnostic tests
//
// Guards the fix for the silent-miscompilation blocker: previously, when an
// element id passed to ui.bind / ui.bindInput / ui.bindList / ui.drawCanvas /
// onTap / onClick / onToggle / onChange / onPress / onRelease was not found
// in the screen, resolveNodeIndex() returned 0 and the call was silently
// re-targeted at the root node. These tests assert the transpiler now emits a
// `ui-unknown-element` ERROR diagnostic for each binding call site and does
// not record the binding against node 0.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resetUIRegistry,
  loadUIModule,
  clearEntryHasUI,
} from "../../../packages/ui/src/ui-engine/ui-registry";
import {
  tryResolveUICall,
  resetUICallState,
  registerUIModuleImport,
} from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";
import type { Diagnostic } from "../../../packages/cuttlefish/src/types";

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  resetUIRegistry();
  resetUICallState();
  clearEntryHasUI();
});

/** Parse a statement and return the first CallExpression it contains. */
function firstCallExpr(stmt: string): ts.CallExpression {
  const file = ts.createSourceFile("x.ts", stmt, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(file);
  if (calls.length === 0) throw new Error("no call expression in: " + stmt);
  return calls[0];
}

/** Set up a UI registry with one screen containing a single <text id="real">. */
function setupScreenWithRealId(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-unknown-elem-"));
  tempDirs.push(dir);
  const htmlPath = path.join(dir, "app.ui.html");
  fs.writeFileSync(htmlPath, `<screen><text id="real">x</text></screen>`, "utf-8");
  fs.writeFileSync(path.join(dir, "app.ui.css"), ``, "utf-8");
  loadUIModule(htmlPath);
  registerUIModuleImport("screen", htmlPath);
  return htmlPath;
}

describe("ui-unknown-element diagnostic — binding call sites", () => {
  let diagnostics: Diagnostic[];

  beforeEach(() => {
    resetUIRegistry();
    resetUICallState();
    clearEntryHasUI();
    diagnostics = [];
  });

  it("ui.bind(typo) emits ui-unknown-element error", () => {
    setupScreenWithRealId();
    const call = firstCallExpr("ui.bind(screen.typo, 'color', () => 'red');");
    tryResolveUICall(call, "x.ts", "ui.bind(screen.typo, 'color', () => 'red');", diagnostics);

    const diag = diagnostics.find((d) => d.code === "ui-unknown-element");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
    expect(diag!.message).toMatch(/typo/);
  });

  it("ui.bind(real) does NOT emit ui-unknown-element", () => {
    setupScreenWithRealId();
    const call = firstCallExpr("ui.bind(screen.real, 'color', () => 'red');");
    tryResolveUICall(call, "x.ts", "ui.bind(screen.real, 'color', () => 'red');", diagnostics);

    expect(diagnostics.some((d) => d.code === "ui-unknown-element")).toBe(false);
  });

  it("ui.bindInput(typo) emits ui-unknown-element error", () => {
    setupScreenWithRealId();
    const call = firstCallExpr("ui.bindInput(screen.typo, (t) => {});");
    tryResolveUICall(call, "x.ts", "ui.bindInput(screen.typo, (t) => {});", diagnostics);

    const diag = diagnostics.find((d) => d.code === "ui-unknown-element");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
  });

  it("ui.bindList(typo) emits ui-unknown-element error", () => {
    setupScreenWithRealId();
    const call = firstCallExpr("ui.bindList(screen.typo, () => 3, (i) => 'x');");
    tryResolveUICall(call, "x.ts", "ui.bindList(screen.typo, () => 3, (i) => 'x');", diagnostics);

    const diag = diagnostics.find((d) => d.code === "ui-unknown-element");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
  });

  it("ui.onTap(typo) emits ui-unknown-element error (not silent fallback to global)", () => {
    setupScreenWithRealId();
    const call = firstCallExpr("await ui.onTap(screen.typo);");
    tryResolveUICall(call, "x.ts", "await ui.onTap(screen.typo);", diagnostics);

    const diag = diagnostics.find((d) => d.code === "ui-unknown-element");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
  });

  it("ui.drawCanvas(typo) emits ui-unknown-element error", () => {
    setupScreenWithRealId();
    const call = firstCallExpr("ui.drawCanvas(screen.typo, (ctx) => { ctx.fillScreen('black'); });");
    tryResolveUICall(call, "x.ts", "ui.drawCanvas(screen.typo, (ctx) => { ctx.fillScreen('black'); });", diagnostics);

    const diag = diagnostics.find((d) => d.code === "ui-unknown-element");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
  });

  // onClick / onToggle / onChange / onPress / onRelease are lowered via
  // call-statement.ts (method calls on the element, not ui.X calls), so they
  // are covered by ui-unknown-element-methods.test.ts which drives
  // callToStatement directly.
});
