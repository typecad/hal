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
    // screen + greeting + btn = 3 NODE_* lines
    const kindLines = out.nodeTable.match(/NODE_(FILL|TEXT)/g) ?? [];
    expect(kindLines).toHaveLength(3);
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
