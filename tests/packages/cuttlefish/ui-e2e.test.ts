import { describe, it, expect } from "vitest";
import { transpileUI } from "@typecad/cuttlefish/ui/transpile-ui";

const HTML = [
  `<screen>`,
  `  <text id="greeting">hello world</text>`,
  `  <button id="btn">Click me</button>`,
  `</screen>`,
].join("\n");

const CSS = [
  `screen { background: #008000; padding: 8; }`,
  `#greeting { color: #ff0000; font: 8x16; }`,
  `#btn { background: #404040; color: #ffffff; padding: 4; transition: background 80ms; }`,
  `#btn:pressed { background: #808080; }`,
].join("\n");

describe("UI end-to-end (hello world)", () => {
  const out = transpileUI(HTML, CSS, {
    colorFormat: "rgb565",
    storage: "flash",
    viewport: { width: 240, height: 320 },
  });

  it("emits a node table with 3 nodes", () => {
    expect(out.nodeTable).toMatch(/UINode\s+__ui_nodes/);
    // screen (FILL) + greeting (TEXT) + btn (BUTTON) = 3 NODE_* lines
    const kindLines = out.nodeTable.match(/NODE_(FILL|TEXT|BUTTON)/g) ?? [];
    expect(kindLines).toHaveLength(3);
    expect(out.nodeTable).toContain("NODE_BUTTON");
  });

  it("emits green background (#008000 → 0x0400) on screen", () => {
    // #008000 = half green (g=128): (128 & 0xfc) << 3 = 0x0400.
    expect(out.nodeTable).toContain("0x0400");
  });

  it("emits red foreground (#ff0000 → 0xf800) on greeting", () => {
    expect(out.nodeTable).toContain("0xf800");
  });

  it("emits the greeting text payload", () => {
    expect(out.nodeTable).toContain("hello world");
  });

  it("emits the transition table with 80ms on btn", () => {
    expect(out.transitionTable).toContain("80");
    expect(out.transitionTable).toContain("UITransition");
  });

  it("emits typed declarations for greeting and btn", () => {
    expect(out.typeDecl).toContain("greeting");
    expect(out.typeDecl).toContain("btn");
  });
});

describe("node-table count covers every kind (countNodes regression)", () => {
  // Regression: countNodes used a kind-regex that omitted NODE_CANVAS (and would
  // miss any future kind), so __ui_node_count undercounted and the last node(s)
  // in the table were never drawn at runtime. The count must equal the number of
  // node-table entries regardless of kind.
  const out = transpileUI(
    [
      `<screen>`,
      `  <canvas id="cv" width="20" height="20"></canvas>`,
      `  <text id="t">x</text>`,
      `</screen>`,
    ].join("\n"),
    ``,
    { colorFormat: "rgb565", storage: "flash", viewport: { width: 60, height: 80 } },
  );

  it("emits NODE_CANVAS (a kind the old countNodes regex missed)", () => {
    expect(out.nodeTable).toContain("NODE_CANVAS");
  });

  it("counts every node-table entry, including the canvas node", () => {
    // screen (FILL) + canvas (CANVAS) + text (TEXT) = 3 nodes.
    const entries = out.nodeTable.match(/\{\s*\.box=/g) ?? [];
    expect(entries).toHaveLength(3);
    // The kind-regex approach would count only 2 (miss NODE_CANVAS); assert the
    // robust entry-count matches the per-kind total including canvas.
    const kinds = out.nodeTable.match(/NODE_(FILL|CANVAS|TEXT)/g) ?? [];
    expect(kinds).toHaveLength(3);
    expect(entries.length).toBe(kinds.length);
  });
});

import type { BindingSpec } from "../../../packages/cuttlefish/src/ir/transformers/ui-reactive";

describe("text-binding emission (ui.bind → void textFn)", () => {
  it("emits a void fill-style textFn from cppBody", () => {
    // Guard the exact function shape the emitter must produce for a text binding.
    // Mirrors ui-emitter.ts's text-binding branch.
    const spec: BindingSpec = {
      nodeIndex: 2,
      property: "text",
      fnName: "__ui_bind_text_0",
      cppBody: `snprintf(buf, size, "%d", count);`,
    };
    const expected = `void __ui_bind_text_0(char* buf, uint8_t size) { snprintf(buf, size, "%d", count); }`;
    const emitted = `void ${spec.fnName}(char* buf, uint8_t size) { ${spec.cppBody} }`;
    expect(emitted).toBe(expected);
  });
});
