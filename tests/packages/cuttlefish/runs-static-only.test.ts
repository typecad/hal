import { describe, it, expect, beforeEach } from "vitest";
import { autoWireElements } from "../../../packages/cuttlefish/src/ir/ui-element-auto-wire";
import { recordBinding, uiBindings, resetUICallState, getDiagnostics } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

// A node with rich-text runs cannot also have a PROP_TEXT binding: runs are
// static-content only (the binding model replaces the whole text buffer, which
// is incompatible with precomputed run geometry). Enforcing this at binding-
// record time surfaces the conflict as a diagnostic instead of silently
// producing a node that can't render its bound value.

describe("runs vs bindings static-only rule", () => {
  beforeEach(() => {
    resetUICallState();
  });

  it("a PROP_TEXT binding on a run-bearing node is rejected with a diagnostic", () => {
    // Build a tree where node index 1 (the <p>) has runs.
    const tree = {
      tag: "screen",
      children: [{ tag: "text", id: "p", children: [], runs: [{ text: "hi", style: {} }] }],
    } as any;
    autoWireElements("ui", tree);  // walks the tree, marking run-bearing indices

    // Author attempts a text binding on the run-bearing <p> (index 1).
    recordBinding({ nodeIndex: 1, property: "text", fnName: "__ui_p_text", cppExpr: "x", cppBody: "x" } as any);

    // The binding is dropped (not recorded).
    expect(uiBindings().find(b => b.nodeIndex === 1 && b.property === "text")).toBeUndefined();
    // And a diagnostic was emitted.
    expect(getDiagnostics().some(d => d.code === "run-text-binding-conflict")).toBe(true);
  });

  it("a PROP_TEXT binding on a plain (non-run) node is allowed", () => {
    const tree = {
      tag: "screen",
      children: [{ tag: "text", id: "t", children: [], text: "hi" }],
    } as any;
    autoWireElements("ui", tree);
    recordBinding({ nodeIndex: 1, property: "text", fnName: "__ui_t_text", cppExpr: "x", cppBody: "x" } as any);
    expect(uiBindings().find(b => b.nodeIndex === 1 && b.property === "text")).toBeDefined();
    expect(getDiagnostics().some(d => d.code === "run-text-binding-conflict")).toBe(false);
  });
});
