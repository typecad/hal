import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resetUIRegistry,
  loadUIModule,
  clearEntryHasUI,
} from "../../../packages/cuttlefish/src/ui/ui-registry";
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
  const file = ts.createSourceFile(
    "x.ts",
    stmt,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(file);
  if (calls.length === 0) throw new Error("no call expression in: " + stmt);
  return calls[0];
}

describe("ui.onTap resolver — awaitable tap notification", () => {
  let diagnostics: Diagnostic[];

  beforeEach(() => {
    resetUIRegistry();
    resetUICallState();
    clearEntryHasUI();
    diagnostics = [];
  });

  it("lowers arg-less `ui.onTap()` to the __UI_TAP__ marker (any tap)", () => {
    const call = firstCallExpr("await ui.onTap();");
    const ir = tryResolveUICall(call, "x.ts", "await ui.onTap();", diagnostics);

    expect(ir).not.toBeNull();
    expect(ir!.kind).toBe("call");
    const callIr = ir as Extract<typeof ir, { kind: "call" }>;
    expect(callIr.callee).toBe("__UI_TAP__");
    expect(callIr.isAwaited).toBe(true);
    expect(callIr.args).toHaveLength(1);
    expect((callIr.args[0] as { kind: string; value: number })).toMatchObject({
      kind: "number",
      value: -1,
    });
  });

  it("lowers `ui.onTap(screen.btn)` to a per-node marker with the resolved index", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ontap-resolver-"));
    tempDirs.push(dir);
    const htmlPath = path.join(dir, "app.ui.html");
    fs.writeFileSync(htmlPath, `<screen><button id="btn">x</button></screen>`, "utf-8");
    fs.writeFileSync(path.join(dir, "app.ui.css"), ``, "utf-8");
    loadUIModule(htmlPath);
    registerUIModuleImport("screen", htmlPath);

    const call = firstCallExpr("await ui.onTap(screen.btn);");
    const ir = tryResolveUICall(call, "x.ts", "await ui.onTap(screen.btn);", diagnostics);

    expect(ir).not.toBeNull();
    const callIr = ir as Extract<typeof ir, { kind: "call" }>;
    expect(callIr.callee).toBe("__UI_TAP__");
    expect(callIr.isAwaited).toBe(true);
    // btn is the only child of <screen>. The walker descends from the screen
    // root (idx 0) to its children, so btn lands at idx 1 — matching the
    // emitted C++ node table (the screen FILL node is index 0, btn is 1).
    const nodeArg = callIr.args[0] as { kind: string; value: number };
    expect(nodeArg).toMatchObject({ kind: "number", value: 1 });
  });

  it("falls back to any-tap with a warning when the node cannot be resolved", () => {
    const call = firstCallExpr("await ui.onTap(screen.unknown);");
    const ir = tryResolveUICall(call, "x.ts", "await ui.onTap(screen.unknown);", diagnostics);

    expect(ir).not.toBeNull();
    const callIr = ir as Extract<typeof ir, { kind: "call" }>;
    expect(callIr.callee).toBe("__UI_TAP__");
    const nodeArg = callIr.args[0] as { kind: string; value: number };
    expect(nodeArg.value).toBe(-1);
    expect(diagnostics.some((d) => d.code === "ui-ontap-arg")).toBe(true);
  });
});
