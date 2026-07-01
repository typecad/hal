import { describe, it, expect, beforeEach } from "vitest";
// Import both from source so they share the same module instance (the handler
// registry is module-scoped; mixing the package export with a source import
// would read a different, empty registry).
import { autoWireElements } from "../../../packages/cuttlefish/src/ir/ui-element-auto-wire";
import { clickHandlers, resetUICallState } from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";

// Run-bearing link nodes need a click handler registered at their node index so
// they're hit-testable; the actual navigation happens via the run hit-test
// (ui_rich_link_hit / richLinkHit) in the tap path. This test verifies the
// auto-wire registers that handler.

describe("run-link auto-wire", () => {
  beforeEach(() => {
    resetUICallState();
  });

  it("registers a click handler for a run-bearing node with a link run", () => {
    const tree = {
      tag: "screen",
      children: [
        {
          tag: "text",
          id: "p",
          children: [],
          // A run with an href makes this a run-bearing link node.
          runs: [{ text: "go", style: {}, href: "#home" }],
        },
      ],
    } as any;
    autoWireElements("ui", tree);
    const handlers = clickHandlers();
    // The <p> (index 1) should have a click handler so it's hit-testable.
    const pHandler = handlers.find(h => h.nodeIndex === 1);
    expect(pHandler).toBeDefined();
    expect(pHandler!.kind).toBe("click");
  });

  it("does NOT register a link handler for a run-bearing node with no link runs", () => {
    const tree = {
      tag: "screen",
      children: [
        {
          tag: "text",
          id: "p",
          children: [],
          runs: [{ text: "plain", style: {} }],  // no href
        },
      ],
    } as any;
    autoWireElements("ui", tree);
    const handlers = clickHandlers();
    // No link run → no auto-wired handler (node isn't a tap target).
    expect(handlers.find(h => h.nodeIndex === 1)).toBeUndefined();
  });
});
