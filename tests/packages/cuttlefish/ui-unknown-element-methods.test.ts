// ---------------------------------------------------------------------------
// ui-unknown-element diagnostic tests — element method call sites
//
// Element-method receivers (screen.X.onClick / onToggle / onChange / onPress /
// onRelease) lower through call-statement.ts rather than tryResolveUICall.
// These tests drive callToStatement directly to assert the diagnostic is
// emitted when the element id is not found in the screen.
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
  resetUICallState,
  registerUIModuleImport,
} from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";
import { callToStatement } from "../../../packages/cuttlefish/src/ir/transformers/call-statement";
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

/** Parse a statement; return the ExpressionStatement and its CallExpression. */
function parseStmt(stmt: string): { stmtNode: ts.ExpressionStatement; call: ts.CallExpression } {
  const file = ts.createSourceFile("x.ts", stmt, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const stmtNode = file.statements.find((s): s is ts.ExpressionStatement =>
    ts.isExpressionStatement(s),
  );
  if (!stmtNode) throw new Error("no expression statement in: " + stmt);
  const call = (stmtNode.expression as ts.CallExpression);
  if (!call || !ts.isCallExpression(call)) throw new Error("no call expression in: " + stmt);
  return { stmtNode, call };
}

function setupScreen(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-elem-method-"));
  tempDirs.push(dir);
  const htmlPath = path.join(dir, "app.ui.html");
  fs.writeFileSync(htmlPath, `<screen><button id="real">x</button><view id="realview"></view></screen>`, "utf-8");
  fs.writeFileSync(path.join(dir, "app.ui.css"), ``, "utf-8");
  loadUIModule(htmlPath);
  registerUIModuleImport("screen", htmlPath);
}

describe("ui-unknown-element diagnostic — element-method call sites (call-statement path)", () => {
  let diagnostics: Diagnostic[];

  beforeEach(() => {
    resetUIRegistry();
    resetUICallState();
    clearEntryHasUI();
    diagnostics = [];
  });

  it("screen.typo.onClick emits ui-unknown-element error", () => {
    setupScreen();
    const { stmtNode, call } = parseStmt("screen.typo.onClick(() => {});");
    callToStatement(stmtNode, call, "x.ts", "screen.typo.onClick(() => {});", diagnostics);

    const diag = diagnostics.find((d) => d.code === "ui-unknown-element");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
    expect(diag!.message).toMatch(/typo/);
  });

  it("screen.typo.onToggle emits ui-unknown-element error", () => {
    setupScreen();
    const { stmtNode, call } = parseStmt("screen.typo.onToggle(5);");
    callToStatement(stmtNode, call, "x.ts", "screen.typo.onToggle(5);", diagnostics);

    const diag = diagnostics.find((d) => d.code === "ui-unknown-element");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
  });

  it("screen.real.onClick does NOT emit ui-unknown-element", () => {
    setupScreen();
    const { stmtNode, call } = parseStmt("screen.real.onClick(() => {});");
    callToStatement(stmtNode, call, "x.ts", "screen.real.onClick(() => {});", diagnostics);

    expect(diagnostics.some((d) => d.code === "ui-unknown-element")).toBe(false);
  });
});
