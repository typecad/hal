import { describe, it, expect } from "vitest";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";

describe("CSS subset parser", () => {
  it("parses element selectors", () => {
    const rules = parseCss(`screen { background: #008000; padding: 8; }`);
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toEqual({ compounds: [[{ kind: "element", name: "screen" }]], pseudo: undefined });
    expect(rules[0].properties.padding).toBe("8");
  });

  it("parses id selectors", () => {
    const rules = parseCss(`#greeting { color: #ff0000; }`);
    expect(rules[0].selector).toEqual({ compounds: [[{ kind: "id", name: "greeting" }]], pseudo: undefined });
  });

  it("parses class selectors", () => {
    const rules = parseCss(`.card { padding: 4; }`);
    expect(rules[0].selector).toEqual({ compounds: [[{ kind: "class", name: "card" }]], pseudo: undefined });
  });

  it("parses :pressed pseudo-state", () => {
    const rules = parseCss(`#btn:pressed { background: #808080; }`);
    expect(rules[0].selector).toEqual({ compounds: [[{ kind: "id", name: "btn" }]], pseudo: "pressed" });
  });

  it("parses compound selectors (.foo.bar)", () => {
    const rules = parseCss(`.card.active { color: red; }`);
    expect(rules[0].selector.compounds).toEqual([
      [{ kind: "class", name: "card" }, { kind: "class", name: "active" }],
    ]);
  });

  it("parses tag.class compound selectors", () => {
    const rules = parseCss(`button.primary { color: red; }`);
    expect(rules[0].selector.compounds).toEqual([
      [{ kind: "element", name: "button" }, { kind: "class", name: "primary" }],
    ]);
  });

  it("parses descendant combinators (parent child)", () => {
    const rules = parseCss(`view text { color: red; }`);
    expect(rules[0].selector.compounds).toEqual([
      [{ kind: "element", name: "view" }],
      [{ kind: "element", name: "text" }],
    ]);
  });

  it("parses transition property", () => {
    const rules = parseCss(`#btn { transition: background 80ms; }`);
    expect(rules[0].properties.transition).toEqual({ property: "background", durationMs: 80 });
  });

  it("parses the canonical hello-world css", () => {
    const css = [
      `screen { background: #008000; padding: 8; }`,
      `#greeting { color: #ff0000; font: 8x16; }`,
      `#btn { background: #404040; color: #ffffff; padding: 4; transition: background 80ms; }`,
      `#btn:pressed { background: #808080; }`,
    ].join("\n");
    const rules = parseCss(css);
    expect(rules).toHaveLength(4);
    expect(rules[3].selector.pseudo).toBe("pressed");
  });
});
