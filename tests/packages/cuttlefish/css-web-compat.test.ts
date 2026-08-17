// Web-compatibility behaviors introduced to make the UI engine predictable
// for authors with browser experience: content never silently dropped,
// percent/auto units honored, transparent/currentColor semantics, cascade
// specificity, display-anchored UA scale, and the bundled default font.
import { describe, expect, it } from "vitest";
import { parseHtml } from "@typecad/ui/ui-engine/html-parser";
import { parseCss } from "@typecad/ui/ui-engine/css-parser";
import type { Diagnostic } from "@typecad/cuttlefish/api/shared";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { measure } from "@typecad/ui/ui-engine/layout-engine";
import { selectEngine } from "../../../packages/ui/src/ui-engine/select-engine";
import { lowerUIToModel } from "@typecad/ui/ui-engine/model";
import { uaScaleFor } from "@typecad/ui/ui-engine/ua-stylesheet";
import { injectDefaultFontFaces, DEFAULT_FONT_FAMILY, DEFAULT_MONO_FAMILY } from "@typecad/ui/ui-engine/default-font";
import { normalizeFontFamily } from "@typecad/ui/ui-engine/font-assets";

describe("content is never silently dropped", () => {
  it("renders unknown tags as generic containers with a warning (subtree kept)", () => {
    const diags: Diagnostic[] = [];
    const tree = parseHtml(`<screen><widget id="w"><text id="t">kept</text></widget></screen>`, diags);
    const w = tree.children[0];
    expect(w.tag).toBe("view");
    expect(w.id).toBe("w");
    expect(w.children[0].id).toBe("t");
    expect(w.children[0].text).toBe("kept");
    expect(diags.some((d) => d.code === "unknown-html-tag" && d.source === "widget")).toBe(true);
  });

  it("renders an unknown text-only leaf as a text node", () => {
    const diags: Diagnostic[] = [];
    const tree = parseHtml(`<screen><badge>hot</badge></screen>`, diags);
    expect(tree.children[0].tag).toBe("text");
    expect(tree.children[0].text).toBe("hot");
    expect(diags.some((d) => d.code === "unknown-html-tag")).toBe(true);
  });

  it("keeps stray text next to block children as anonymous text children", () => {
    const tree = parseHtml(`<screen><div id="d">Total: <button id="b">Go</button> items</div></screen>`);
    const d = tree.children[0];
    expect(d.children.map((c) => c.tag)).toEqual(["text", "button", "text"]);
    expect(d.children[0].text).toBe("Total:");
    expect(d.children[2].text).toBe("items");
  });

  it("flows stray text next to only-inline children as one anonymous inline run", () => {
    const tree = parseHtml(`<screen><div id="d">Total: <b>3</b> items</div></screen>`);
    const d = tree.children[0];
    // One anonymous text child carrying the full inline sequence.
    expect(d.children).toHaveLength(1);
    expect(d.children[0].tag).toBe("text");
    expect(d.children[0].inline).toBeDefined();
    expect(d.children[0].inline!.map((i) => (i.kind === "text" ? i.text : i.kind))).toEqual([
      "Total: ", "element", " items",
    ]);
  });
});

describe("web-familiar tag spellings", () => {
  it("remaps input type=checkbox/radio/range to the control tags", () => {
    const tree = parseHtml(
      `<screen><input type="checkbox" id="c" checked/><input type="radio" name="g" id="r"/><input type="range" min="0" max="50" id="s"/><input id="t"/></screen>`,
    );
    expect(tree.children[0].tag).toBe("check");
    expect(tree.children[0].checked).toBe(true);
    expect(tree.children[1].tag).toBe("radio");
    expect(tree.children[1].name).toBe("g");
    expect(tree.children[2].tag).toBe("range");
    expect(tree.children[2].min).toBe("0");
    expect(tree.children[2].max).toBe("50");
    expect(tree.children[3].tag).toBe("input");
  });

  it("marks list items with bullets and numbers", () => {
    const tree = parseHtml(
      `<screen><ul><li id="a">one</li><li id="b">two</li></ul><ol><li id="c">first</li><li id="d">second</li></ol></screen>`,
    );
    const ul = tree.children[0];
    expect(ul.tag).toBe("view");
    expect(ul.children[0].text).toBe("• one");
    expect(ul.children[1].text).toBe("• two");
    const ol = tree.children[1];
    expect(ol.children[0].text).toBe("1. first");
    expect(ol.children[1].text).toBe("2. second");
  });

  it("renders <hr> as a styled rule view and <textarea> as single-line input", () => {
    const diags: Diagnostic[] = [];
    const tree = parseHtml(`<screen><hr id="r"/><textarea id="ta">x</textarea></screen>`, diags);
    expect(tree.children[0].tag).toBe("view");
    const styled = resolveStyles(tree, parseCss(""));
    expect(styled.children[0].style.height).toBe("1px");
    expect(styled.children[0].style.background).toBe("#808080");
    expect(tree.children[1].tag).toBe("input");
    expect(diags.some((d) => d.code === "html-textarea-single-line")).toBe(true);
  });
});

describe("percent and auto units (flexbox layout)", () => {
  const arrange = (css: string) => {
    const styled = resolveStyles(
      parseHtml(`<screen><div id="a">x</div></screen>`),
      parseCss(`screen { display: flex; } ${css}`),
    );
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
    return boxes[1]; // box 0 is the screen
  };

  it("resolves width: 50% against the parent (not 50px)", () => {
    expect(arrange(`#a { width: 50%; height: 20px; }`).w).toBe(160);
  });

  it("resolves height: 25% against the parent", () => {
    expect(arrange(`#a { height: 25%; }`).h).toBe(60);
  });

  it("centers with margin: 0 auto (auto margins absorb free space)", () => {
    const box = arrange(`#a { width: 100px; height: 20px; margin: 0 auto; }`);
    expect(box.w).toBe(100);
    expect(box.x).toBe(110); // (320 - 100) / 2
  });

  it("expands 3- and 4-value padding shorthands TRBL", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><div id="p34"><text>a</text><text>b</text><text>c</text><text>d</text></div></screen>`),
      parseCss([
        `screen { display: flex; width: 200px; height: 400px; }`,
        // 4-value padding: top 1, right 2, bottom 3, left 4.
        `#p34 { display: flex; padding: 1px 2px 3px 4px; }`,
        `#p34 text { height: 10px; }`,
      ].join("\n")),
    );
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 200, h: 400 }, measure);
    // First text child sits at content origin (x=4 left padding, y=1 top).
    expect(boxes[2].x).toBe(4);
    expect(boxes[2].y).toBe(1);
  });
});

describe("transparent and currentColor semantics", () => {
  const lower = (css: string) => {
    const styled = resolveStyles(parseHtml(`<screen><div id="a"><text>t</text></div></screen>`), parseCss(css));
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
    return lowerUIToModel(styled, boxes, "rgb565", { width: 320, height: 240, colorFormat: "rgb565" } as any);
  };

  it("background: transparent paints nothing (parent shows through)", () => {
    const model = lower(`#a { background: transparent; }`);
    expect(model.nodes[1].hasBg).toBe(false);
  });

  it("background: rgba(...,0) is also no-fill", () => {
    const model = lower(`#a { background: rgba(255, 0, 0, 0); }`);
    expect(model.nodes[1].hasBg).toBe(false);
  });

  it("a solid background still fills", () => {
    const model = lower(`#a { background: #ff0000; }`);
    expect(model.nodes[1].hasBg).toBe(true);
  });

  it("border color defaults to currentColor (the node's text color)", () => {
    const model = lower(`#a { color: #123456; border: 2px solid; }`);
    const node = model.nodes[1];
    expect(node.borderColor).toBe(node.fg);
    expect(node.borderColor).not.toBe(0);
  });
});

describe("cascade specificity", () => {
  it("an id rule beats a later class rule (web cascade order)", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><view id="a" class="x"></view></screen>`),
      parseCss(`#a { color: #222222; } .x { color: #111111; }`),
    );
    expect(styled.children[0].style.color).toBe("#222222");
  });

  it("a class rule beats a later element rule", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><text id="a" class="x">t</text></screen>`),
      parseCss(`.x { color: #111111; } text { color: #222222; }`),
    );
    expect(styled.children[0].style.color).toBe("#111111");
  });

  it("equal specificity keeps source order (later wins)", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><view id="a" class="x"></view></screen>`),
      parseCss(`.x { color: #111111; } .x { color: #222222; }`),
    );
    expect(styled.children[0].style.color).toBe("#222222");
  });

  it("author rules beat the UA sheet regardless of specificity", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><button id="b">Go</button></screen>`),
      parseCss(`button { min-height: 10px; }`),
    );
    expect(styled.children[0].style.minHeight).toBe("10px");
  });
});

describe("display-anchored UA scale", () => {
  it("large color displays keep the browser-classic 16px root", () => {
    const s = uaScaleFor(320, false);
    expect(s.root).toBe(16);
    expect(s.h[0]).toBe(24);
    expect(s.h[1]).toBe(20);
    expect(s.controlMinHeight).toBe(48);
  });

  it("320x240 color panels scale down to a 14px root", () => {
    const s = uaScaleFor(240, false);
    expect(s.root).toBe(14);
    expect(s.h[0]).toBe(21);
    expect(s.controlMinHeight).toBe(42);
  });

  it("tiny color panels scale to 12px", () => {
    expect(uaScaleFor(80, false).root).toBe(12);
  });

  it("monochrome displays snap heading sizes to the stock-font buckets", () => {
    const tall = uaScaleFor(128, true);
    expect(tall.root).toBe(12);
    expect(tall.h).toEqual([28, 20, 20, 12, 12, 12]);
    expect(tall.controlMinHeight).toBe(32);
    const short = uaScaleFor(64, true);
    expect(short.h[0]).toBe(20);
  });

  it("exposes the framework-prefixed layout classes", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><view class="ui-scroll-body" id="s"><view class="ui-screen-header" id="h"></view></view></screen>`),
      parseCss(""),
    );
    expect(styled.children[0].style.overflow).toBe("scroll");
    expect(styled.children[0].children[0].style.flexDirection).toBe("row");
  });
});

describe("bundled default font", () => {
  it("injects sans + mono DejaVu faces on color displays", () => {
    const faces = injectDefaultFontFaces([], "rgb565");
    expect(faces).toHaveLength(4);
    const sans = faces.filter((f) => f.fontFamily === DEFAULT_FONT_FAMILY);
    const mono = faces.filter((f) => f.fontFamily === DEFAULT_MONO_FAMILY);
    expect(sans.map((f) => f.fontWeight).sort()).toEqual(["400", "700"]);
    expect(mono.map((f) => f.fontWeight).sort()).toEqual(["400", "700"]);
  });

  it("does not inject on monochrome displays (stock bitmap font)", () => {
    expect(injectDefaultFontFaces([], "mono")).toHaveLength(0);
  });

  it("respects author-registered faces per family", () => {
    const mine = [{ fontFamily: DEFAULT_FONT_FAMILY, src: "my.woff2", fontWeight: "400", fontStyle: "normal" }];
    const merged = injectDefaultFontFaces(mine, "rgb565");
    // The author's sans face wins (no bundled sans injected); the mono family
    // is still bundled.
    expect(merged).toHaveLength(3);
    expect(merged[0]).toBe(mine[0]);
    expect(merged.filter((f) => f.fontFamily === DEFAULT_MONO_FAMILY)).toHaveLength(2);
  });
});

describe("second-wave web elements", () => {
  it("aliases meter to progress and output to text", () => {
    const tree = parseHtml(`<screen><meter id="m" min="0" max="10" value="4"></meter><output id="o">42</output></screen>`);
    expect(tree.children[0].tag).toBe("progress");
    expect(tree.children[0].min).toBe("0");
    expect(tree.children[0].value).toBe("4");
    expect(tree.children[1].tag).toBe("text");
    expect(tree.children[1].text).toBe("42");
  });

  it("styles dl/dt/dd, small, and fieldset with browser-like UA rules", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><p id="rootp">scale</p><dl><dt id="t">temp</dt><dd id="d">21C</dd></dl><small id="s">fine</small><fieldset id="f"><legend id="l">group</legend></fieldset></screen>`),
      parseCss(""),
    );
    // Derive the active UA root from the <p> rule so the assertions hold at
    // every display scale (the test env may bind a real profile).
    const root = parseFloat(styled.children[0].style.fontSize ?? "");
    expect(Number.isFinite(root)).toBe(true);
    expect(styled.children[1].tag).toBe("view");
    const dt = styled.children[1].children[0];
    const dd = styled.children[1].children[1];
    expect(dt.origTag).toBe("dt");
    expect(dt.style.fontWeight).toBe("bold");
    expect(dd.style.marginLeft).toBe(`${Math.round(root * 0.75)}px`);
    expect(styled.children[2].style.fontSize).toBe(`${Math.round(root * 0.8)}px`);
    expect(styled.children[3].style.border).toBe("1px solid");
    expect(Number(styled.children[3].style.padding?.replace("px", ""))).toBeGreaterThan(0);
  });

  it("gives pre/code/kbd the mono family and pre its whitespace", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><pre id="pre">line
two</pre></screen>`),
      parseCss(""),
    );
    expect(styled.children[0].style.whiteSpace).toBe("pre");
    expect(normalizeFontFamily(styled.children[0].style.fontFamily)).toBe(DEFAULT_MONO_FAMILY);
  });

  it("flows inline <code> inside a paragraph with the mono family", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><p id="p">use <code>setup()</code> now</p></screen>`),
      parseCss(""),
    );
    const p = styled.children[0];
    expect(p.runs).toBeDefined();
    const codeRun = p.runs!.find((r) => r.text.includes("setup"));
    expect(normalizeFontFamily(codeRun?.style.fontFamily)).toBe(DEFAULT_MONO_FAMILY);
  });

  it("renders <form> as a plain container without a warning", () => {
    const diags: Diagnostic[] = [];
    const tree = parseHtml(`<screen><form><button id="b">Go</button></form></screen>`, diags);
    expect(tree.children[0].tag).toBe("view");
    expect(tree.children[0].children[0].id).toBe("b");
    expect(diags).toHaveLength(0);
  });

  it("warns specifically on MCU-impossible elements but keeps their content", () => {
    const diags: Diagnostic[] = [];
    const tree = parseHtml(`<screen><svg id="s"><text id="t">fallback</text></svg></screen>`, diags);
    expect(tree.children[0].children[0].id).toBe("t");
    const d = diags.find((x) => x.code === "unsupported-html-tag");
    expect(d?.source).toBe("svg");
    expect(d?.hint).toContain("canvas");
  });

  it("normalizes exotic input types to text input with a warning", () => {
    const diags: Diagnostic[] = [];
    const tree = parseHtml(`<screen><input type="date" id="d"/></screen>`, diags);
    expect(tree.children[0].tag).toBe("input");
    expect(tree.children[0].type).toBe("text");
    expect(diags.some((d) => d.code === "html-input-type-unsupported")).toBe(true);
  });

  it("skips source/track metadata silently", () => {
    const diags: Diagnostic[] = [];
    const tree = parseHtml(`<screen><picture><source srcset="a.webp"/><img src="a.bmp" id="i"/></picture></screen>`, diags);
    // picture renders as a container, source is dropped, img kept.
    expect(tree.children[0].tag).toBe("view");
    expect(tree.children[0].children[0].id).toBe("i");
    expect(diags.some((d) => d.code === "unsupported-html-tag" && d.source === "picture")).toBe(true);
    expect(diags.some((d) => d.source === "source")).toBe(false);
  });
});

describe("tables (equal-width flex approximation)", () => {
  const TABLE_HTML = `<screen><table id="t"><thead><tr><th id="h1">name</th><th id="h2">value</th></tr></thead><tbody><tr><td id="a">temp</td><td id="b">21C</td></tr><tr><td id="c">hum</td><td id="d">40%</td></tr></tbody></table></screen>`;

  it("remaps table structure and notes the approximation", () => {
    const diags: Diagnostic[] = [];
    const tree = parseHtml(TABLE_HTML, diags);
    const table = tree.children[0];
    expect(table.tag).toBe("view");
    expect(table.origTag).toBe("table");
    const thead = table.children[0];
    const headerRow = thead.children[0];
    expect(thead.origTag).toBe("thead");
    expect(headerRow.origTag).toBe("tr");
    expect(headerRow.children[0].origTag).toBe("th");
    expect(headerRow.children[0].text).toBe("name");
    expect(table.children[1].children[0].children[0].origTag).toBe("td");
    expect(diags.some((d) => d.code === "html-table-approximation" && d.severity === "info")).toBe(true);
  });

  it("styles rows/cells with browser-like UA rules", () => {
    const styled = resolveStyles(parseHtml(TABLE_HTML), parseCss(""));
    const table = styled.children[0];
    const headerRow = table.children[0].children[0];
    const th = headerRow.children[0];
    const td = table.children[1].children[0].children[0];
    expect(headerRow.style.flexDirection).toBe("row");
    expect(th.style.flexGrow).toBe("1");
    expect(th.style.fontWeight).toBe("bold");
    expect(th.style.textAlign).toBe("center");
    expect(td.style.flexGrow).toBe("1");
    expect(td.style.textAlign).toBe("left");
    expect(Number(td.style.padding?.replace("px", ""))).toBeGreaterThan(0);
  });

  it("lays out cells as equal-width columns with stacked rows", () => {
    const styled = resolveStyles(parseHtml(TABLE_HTML), parseCss("screen { display: flex; }"));
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
    // Pre-order DFS: screen, table, thead, tr, th, th, tbody, tr, td, td, tr, td, td.
    const row1 = boxes[3];
    const th1 = boxes[4];
    const th2 = boxes[5];
    const row2 = boxes[8];
    expect(Math.abs(th1.w - th2.w)).toBeLessThanOrEqual(1);  // equal columns
    expect(th1.w).toBeGreaterThanOrEqual(150);               // ~half of 320
    expect(th2.x).toBeGreaterThan(th1.x);                    // side by side
    expect(row2.y).toBeGreaterThan(row1.y + row1.h - 1);     // rows stacked
  });

  it("warns on colspan/rowspan (no span support)", () => {
    const diags: Diagnostic[] = [];
    const tree = parseHtml(`<screen><table><tr><td colspan="2">wide</td></tr></table></screen>`, diags);
    expect(tree.children[0].children[0].children[0].text).toBe("wide");
    expect(diags.some((d) => d.code === "html-table-span-unsupported")).toBe(true);
  });
});

describe("CSS value warnings and shorthand fixes", () => {
  it("border shorthand accepts bare and decimal widths (unitless = px)", () => {
    const rules = parseCss(`#a { border: 2 solid red; } #b { border: 1.5px solid blue; }`);
    expect(rules[0].properties.borderWidth).toBe("2px");
    expect(rules[0].properties.borderColor).toBe("red");
    expect(rules[1].properties.borderWidth).toBe("1.5px");
  });

  it("font shorthand applies the size/line-height pair", () => {
    const rules = parseCss(`#a { font: bold 18px/22px Custom; }`);
    expect(rules[0].properties.fontSize).toBe("18px");
    expect(rules[0].properties.lineHeight).toBe("22px");
    expect(rules[0].properties.fontWeight).toBe("bold");
    expect(rules[0].properties.fontFamily).toBe("Custom");
  });

  it("warns on values the engine can only partially honor", () => {
    const diags: Diagnostic[] = [];
    parseCss(
      [
        `#a { box-sizing: content-box; }`,
        `#b { display: inline-block; }`,
        `#c { position: sticky; }`,
        `#d { font-size: 120%; }`,
        `#e { line-height: 1.4; }`,
      ].join("\n"),
      diags,
    );
    const codes = diags.map((d) => d.code);
    expect(codes).toContain("css-box-sizing");
    expect(codes).toContain("css-display");
    expect(codes).toContain("css-position");
    expect(codes).toContain("css-font-size-unit");
    expect(codes).toContain("css-line-height");
  });
});
