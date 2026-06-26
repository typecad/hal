import { describe, it, expect } from "vitest";
import { parseAnimation, parseCss, parseFontFaces, parseInlineStyle, parseKeyframes } from "@typecad/cuttlefish/ui/css-parser";

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

  it("parses CSS variables from :root and substitutes var() refs", () => {
    const rules = parseCss(`:root { --accent: #ff0000; } .btn { background: var(--accent); }`);
    expect(rules).toHaveLength(1);
    expect(rules[0].properties.background).toBe("#ff0000");
  });

  it("parses inline style strings", () => {
    const props = parseInlineStyle("color: red; font-size: 16px; background: #000");
    expect(props.color).toBe("red");
    expect(props.fontSize).toBe("16px");
    expect(props.background).toBe("#000");
  });

  it("parses object-fit declarations", () => {
    const rules = parseCss(`img.logo { object-fit: contain; }`);
    expect(rules[0].properties.objectFit).toBe("contain");
    expect(parseInlineStyle("width: 60px; object-fit: cover").objectFit).toBe("cover");
  });

  it("parses display none declarations", () => {
    const rules = parseCss(`#panel { display: none; }`);
    expect(rules[0].properties.display).toBe("none");
    expect(parseInlineStyle("display: none").display).toBe("none");
  });

  it("parses font family and smoothing declarations", () => {
    const rules = parseCss(`#title { font-family: "FreeSans"; font-style: italic; font-smoothing: antialiased; font-subset: fallback; }`);
    expect(rules[0].properties.fontFamily).toBe('"FreeSans"');
    expect(rules[0].properties.fontStyle).toBe("italic");
    expect(rules[0].properties.fontSmoothing).toBe("antialiased");
    expect(rules[0].properties.fontSubset).toBe("fallback");
  });

  it("parses font shorthand into variant, size, and family fields", () => {
    const rules = parseCss(`#title { font: italic bold 18px FreeSans; }`);
    expect(rules[0].properties.fontStyle).toBe("italic");
    expect(rules[0].properties.fontWeight).toBe("bold");
    expect(rules[0].properties.fontSize).toBe("18px");
    expect(rules[0].properties.fontFamily).toBe("FreeSans");
  });

  it("parses @font-face declarations", () => {
    const faces = parseFontFaces(`
      @font-face {
        font-family: "DeviceSans";
        src: url("./DeviceSans.ttf") format("truetype");
        font-weight: 400;
      }
      #title { font-family: "DeviceSans"; }
    `);
    expect(faces).toEqual([
      { fontFamily: "DeviceSans", src: "./DeviceSans.ttf", fontWeight: "400", fontStyle: undefined },
    ]);
  });

  it("parses transition property", () => {
    const rules = parseCss(`#btn { transition: background 80ms; }`);
    expect(rules[0].properties.transition).toEqual({ property: "background", durationMs: 80 });
  });

  it("parses animation shorthand", () => {
    expect(parseAnimation("pulse 2s infinite 150ms")).toEqual({
      name: "pulse",
      durationMs: 2000,
      iterations: -1,
      delayMs: 150,
    });
    expect(parseAnimation("750ms fade 3")).toEqual({
      name: "fade",
      durationMs: 750,
      iterations: 3,
      delayMs: 0,
    });
  });

  it("parses @keyframes grouped stops without leaking them as CSS selectors", () => {
    const css = `
      :root { --pulse-start: #1a6b3c; }
      @keyframes pulse {
        0%, 100% { background: var(--pulse-start); opacity: 1; }
        50% { background: #4ade80; opacity: 0.5; color: white; }
      }
      #pulseIndicator { animation: pulse 2s infinite; }
    `;
    const keyframes = parseKeyframes(css);
    expect(keyframes).toEqual([{
      name: "pulse",
      stops: [
        { percent: 0, background: "#1a6b3c", opacity: "1" },
        { percent: 50, background: "#4ade80", color: "white", opacity: "0.5" },
        { percent: 100, background: "#1a6b3c", opacity: "1" },
      ],
    }]);

    const rules = parseCss(css);
    expect(rules).toHaveLength(1);
    expect(rules[0].selector.compounds).toEqual([[{ kind: "id", name: "pulseIndicator" }]]);
    expect(rules[0].properties.animation).toBe("pulse 2s infinite");
  });

  it("parses transform declarations inside @keyframes", () => {
    const keyframes = parseKeyframes(`
      @keyframes move {
        from { transform: translateX(0px); }
        50% { transform: translate(8px, -3px); transform-origin: left top; left: 2px; top: 1px; width: 24px; height: 16px; }
        to { transform: translateY(4px); width: 12px; height: 10px; }
      }
    `);

    expect(keyframes).toEqual([{
      name: "move",
      stops: [
        { percent: 0, transform: "translateX(0px)" },
        { percent: 50, transform: "translate(8px,-3px)", transformOrigin: "left top", left: "2px", top: "1px", width: "24px", height: "16px" },
        { percent: 100, transform: "translateY(4px)", width: "12px", height: "10px" },
      ],
    }]);
  });

  it("parses transform-origin declarations in normal rules", () => {
    const rules = parseCss(`#box { transform: scale(1.5); transform-origin: left top; }`);
    expect(rules[0].properties.transform).toBe("scale(1.5)");
    expect(rules[0].properties.transformOrigin).toBe("left top");
  });

  it("parses z-index declarations", () => {
    const rules = parseCss(`#modal { position: absolute; z-index: 20; }`);
    expect(rules[0].properties.position).toBe("absolute");
    expect(rules[0].properties.zIndex).toBe("20");
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
