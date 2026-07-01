import { describe, it, expect } from "vitest";
import { parseCss, parseInlineStyle, parseFontFaces, parseKeyframes, parseAnimation } from "@typecad/cuttlefish/ui/css-parser";
// For tests that touch theme state, import parseCss from src so it shares the
// same module instance as setThemeClass (the package export resolves to dist).
import { parseCss as parseCssSrc } from "../../../packages/cuttlefish/src/ui/css-parser";
import { setThemeClass } from "../../../packages/cuttlefish/src/ui/theme-store";

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

  it("parses aspect ratio declarations", () => {
    const rules = parseCss(`#panel { aspect-ratio: 16 / 9; }`);
    expect(rules[0].properties.aspectRatio).toBe("16/9");
    expect(parseInlineStyle("width: 80px; aspect-ratio: 1 / 1").aspectRatio).toBe("1 / 1");
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
      timingFunction: "",
    });
    expect(parseAnimation("750ms fade 3")).toEqual({
      name: "fade",
      durationMs: 750,
      iterations: 3,
      delayMs: 0,
      timingFunction: "",
    });
  });

  it("captures animation-timing-function from the shorthand", () => {
    // The keyword is no longer swallowed — it rides on the decl and is applied
    // to the lerp factor between keyframe stops. Order-invariant.
    expect(parseAnimation("slideXY 1800ms ease-in-out infinite")!.timingFunction).toBe("ease-in-out");
    expect(parseAnimation("ease 2s pulse")!.timingFunction).toBe("ease");
    expect(parseAnimation("pulse 2s linear infinite")!.timingFunction).toBe("linear");
    // Non-timing keywords (fill-mode, direction, play-state) are still ignored.
    expect(parseAnimation("pulse 2s infinite forwards alternate")!.timingFunction).toBe("");
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

  it("parses flex-direction including reverse values", () => {
    const rules = parseCss(`#a { flex-direction: row-reverse; } #b { flex-direction: column-reverse; }`);
    expect(rules[0].properties.flexDirection).toBe("row-reverse");
    expect(rules[1].properties.flexDirection).toBe("column-reverse");
  });

  it("parses align-content", () => {
    const rules = parseCss(`#wrap { align-content: space-between; }`);
    expect(rules[0].properties.alignContent).toBe("space-between");
  });

  it("splits row-gap and column-gap into separate fields", () => {
    const rules = parseCss(`#grid { row-gap: 10; column-gap: 4; }`);
    expect(rules[0].properties.rowGap).toBe("10");
    expect(rules[0].properties.columnGap).toBe("4");
  });

  it("uniform gap sets both row-gap and column-gap", () => {
    const rules = parseCss(`#grid { gap: 8; }`);
    expect(rules[0].properties.gap).toBe("8");
    expect(rules[0].properties.rowGap).toBe("8");
    expect(rules[0].properties.columnGap).toBe("8");
  });

  it("parses text-overflow: ellipsis", () => {
    const rules = parseCss(`#label { text-overflow: ellipsis; }`);
    expect(rules[0].properties.textOverflow).toBe("ellipsis");
  });

  it("emits a warning for an unknown CSS property when given a diagnostics sink", () => {
    const diags: any[] = [];
    parseCss(`#x { bogus-prop: red; color: #fff; }`, diags);
    const unknown = diags.filter(d => d.message.includes("bogus-prop"));
    expect(unknown).toHaveLength(1);
    expect(unknown[0].severity).toBe("warning");
    // Known property produces no warning.
    expect(diags.some(d => d.message.includes("color"))).toBe(false);
  });

  it("emits a distinct warning for per-side border properties", () => {
    const diags: any[] = [];
    parseCss(`#x { border-bottom: 1px solid #888; }`, diags);
    const border = diags.filter(d => d.message.includes("border-bottom"));
    expect(border).toHaveLength(1);
    expect(border[0].severity).toBe("warning");
    expect(border[0].hint).toBeTruthy();
  });

  it("emits no warnings when no diagnostics sink is passed (backward compatible)", () => {
    // No diagnostics param — must not throw and must return rules normally.
    const rules = parseCss(`#x { bogus-prop: red; color: #fff; }`);
    expect(rules).toHaveLength(1);
    expect(rules[0].properties.color).toBe("#fff");
  });

  it("warns on unknown inline-style properties", () => {
    const diags: any[] = [];
    const props = parseInlineStyle(`color: #fff; made-up: 5`, diags);
    expect(props.color).toBe("#fff");
    expect(diags.filter(d => d.message.includes("made-up"))).toHaveLength(1);
  });

  it("skips rules inside a non-matching @media (compile-time eval)", () => {
    // Default profile is 320x240, so max-width:240 does NOT apply.
    const rules = parseCss(`@media (max-width: 240px) { #small { color: red; } } #always { color: green; }`);
    const ids = rules.map(r => r.selector.compounds[0][0].name);
    expect(ids).not.toContain("small");
    expect(ids).toContain("always");
  });

  it("applies rules inside a matching @media", () => {
    // min-width:100 applies on a 320-wide display.
    const rules = parseCss(`@media (min-width: 100px) { #big { color: blue; } }`);
    expect(rules.map(r => r.selector.compounds[0][0].name)).toContain("big");
  });

  it("warns on an unsupported @media condition", () => {
    const diags: any[] = [];
    parseCss(`@media (orientation: portrait) { #x { color: red; } }`, diags);
    expect(diags.some(d => /unsupported condition/i.test(d.message))).toBe(true);
  });

  it("parses :not() negation into the not field", () => {
    const rules = parseCss(`button:not(.disabled) { color: red; }`);
    expect(rules[0].selector.not).toEqual([[{ kind: "class", name: "disabled" }]]);
  });

  it("parses compound :not() negation", () => {
    const rules = parseCss(`.a:not(.b.c) { color: red; }`);
    expect(rules[0].selector.not).toEqual([
      [{ kind: "class", name: "b" }, { kind: "class", name: "c" }],
    ]);
  });

  it("tokenizes adjacent sibling combinator (+)", () => {
    const rules = parseCss(`.a + .b { color: red; }`);
    expect(rules[0].selector.combinators).toEqual(["+"]);
  });

  it("tokenizes general sibling combinator (~)", () => {
    const rules = parseCss(`.x ~ .y { color: red; }`);
    expect(rules[0].selector.combinators).toEqual(["~"]);
  });

  it("resolves class-scoped variables against the active theme class", () => {
    const css = `:root { --bg: #ffffff; } .dark { --bg: #0a0a0a; } .card { background: var(--bg); }`;
    setThemeClass(null);
    const light = parseCssSrc(css);
    expect(light[0].properties.background).toBe("#ffffff");
    setThemeClass("dark");
    const dark = parseCssSrc(css);
    expect(dark[0].properties.background).toBe("#0a0a0a");
    setThemeClass(null);
  });

  it("evaluates calc() after var() substitution", () => {
    const css = `:root { --radius: 10px; } .card { border-radius: calc(var(--radius) - 4px); }`;
    const rules = parseCssSrc(css);
    expect(rules[0].properties.borderRadius).toBe("6px");
  });

  it("evaluates calc() with multiplication and unit conversion", () => {
    const css = `:root { --r: 0.625rem; } .a { padding: calc(var(--r) * 2); }`;
    const rules = parseCssSrc(css);
    // 0.625rem = 10px, * 2 = 20
    expect(rules[0].properties.padding).toBe("20rem");
  });

  it("border shorthand captures a var() color (not silently dropped)", () => {
    // Regression: parseBorderShorthand only matched #hex/rgb()/named colors, so
    // `border: 2px solid var(--fg)` set borderWidth + borderStyle but left
    // borderColor unset. var() substitution runs AFTER shorthand parsing (on
    // the string properties), so the dropped borderColor never got the token
    // value and resolved to the default (black). var() must be recognized as a
    // color token so borderColor is captured, then substituted like the rest.
    const css = `:root { --fg: #ffffff; } #b { border: 2px solid var(--fg); }`;
    const rules = parseCssSrc(css);
    const props = rules.find(r => r.selector.compounds.flat().some(s => s.name === "b"))!.properties;
    expect(props.borderWidth).toBe("2px");
    expect(props.borderStyle).toBe("solid");
    expect(props.borderColor).toBe("#ffffff");  // var(--fg) captured + substituted
  });
});
