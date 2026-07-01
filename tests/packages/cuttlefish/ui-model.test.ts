import { describe, expect, it } from "vitest";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { measure } from "@typecad/cuttlefish/ui/layout-engine";
import { lowerUIToModel } from "@typecad/cuttlefish/ui/model";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import type { StyledNode } from "@typecad/cuttlefish/ui/style-resolver";
import type { Box } from "@typecad/cuttlefish/ui/layout-engine";
import { lowerUIToCpp } from "@typecad/cuttlefish/ir/transformers/ui-lowering";
import { selectEngine } from "../../../packages/cuttlefish/src/ui/select-engine";

describe("UI structured model", () => {
  it("contains the same resolved box/color data used by C++ lowering", () => {
    const html = `<screen><button id="btn">Go</button></screen>`;
    const css = [
      `screen { background: #008000; display: flex; padding: 8px; }`,
      `#btn { background: darkgreen; color: white; border: 2px solid limegreen; padding: 4px 8px; transition: background 80ms; }`,
      `#btn:pressed { background: limegreen; }`,
    ].join("\n");
    const styled = resolveStyles(parseHtml(html), parseCss(css));
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
    const model = lowerUIToModel(styled, boxes, "rgb565", {
      driver: "ili9341",
      width: 320,
      height: 240,
      colorFormat: "rgb565",
      rotation: 1,
    });
    const cpp = lowerUIToCpp(styled, boxes, "rgb565", "flash");

    expect(model.width).toBe(320);
    expect(model.height).toBe(240);
    expect(model.nodes).toHaveLength(2);
    expect(model.nodes[0].bg).toBe(0x0400);
    expect(model.nodes[1].kind).toBe("button");
    expect(model.nodes[1].borderColor).toBe(0x3666);
    expect(model.transitions[0]).toMatchObject({ node: 1, durationMs: 80, pressedTarget: 0x3666 });
    expect(cpp.nodeTable).toContain(`.box={${model.nodes[1].box.x},${model.nodes[1].box.y},${model.nodes[1].box.w},${model.nodes[1].box.h}}`);
    expect(cpp.transitionTable).toContain(".durationMs=80");
  });

  it("bounds scroll content to the scroll node subtree", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><view id="body"><text id="a">A</text><text id="b">B</text></view><text id="footer">Footer</text></screen>`),
      parseCss(`#body { overflow: scroll; }`),
    );
    const boxes = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 0, y: 0, w: 100, h: 20 },
      { x: 0, y: 0, w: 12, h: 16 },
      { x: 0, y: 20, w: 12, h: 16 },
      { x: 0, y: 100, w: 72, h: 16 },
    ];
    const model = lowerUIToModel(styled, boxes, "rgb565");
    const body = model.nodes.find((node) => node.id === "body")!;
    const footer = model.nodes.find((node) => node.id === "footer")!;

    expect(body.parentIndex).toBe(0);
    expect(body.subtreeEnd).toBe(footer.index);
    expect(footer.parentIndex).toBe(0);
    expect(body.contentHeight).toBe(36);
  });

  it("lowers an <input> node to kind 'input' with maxlen and placeholder", () => {
    const styled: StyledNode = {
      tag: "input",
      id: "ssid",
      classes: [],
      style: {},
      children: [],
      type: "text",
      placeholder: "SSID",
      maxlen: 32,
    };
    const boxes: Box[] = [{ x: 0, y: 0, w: 100, h: 20 }];
    const prog = lowerUIToModel(styled, boxes, "rgb565");
    expect(prog.nodes[0].kind).toBe("input");
    expect(prog.nodes[0].maxlen).toBe(32);
    expect(prog.nodes[0].textBuffer).toBe("SSID");
  });
});

describe("scroll & virtualization", () => {
  it("marks <list> nodes as virtualized scroll containers", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><list id="lst" item-height="20"></list></screen>`),
      parseCss(``),
    );
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 240, h: 320 }, measure);
    const model = lowerUIToModel(styled, boxes, "rgb565");
    const list = model.nodes.find((n) => n.id === "lst");
    expect(list).toBeDefined();
    expect(list!.scrollable).toBe(true);          // UA rule: list { overflow: scroll }
    expect(list!.virtualized).toBe(true);
    expect(list!.listItemHeight).toBe(20);
  });

  it("marks generic overflow:scroll containers as scrollable but not virtualized", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><view id="box" style="overflow: scroll"><view id="c1"></view><view id="c2"></view></view></screen>`),
      parseCss(``),
    );
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 240, h: 320 }, measure);
    const model = lowerUIToModel(styled, boxes, "rgb565");
    const box = model.nodes.find((n) => n.id === "box");
    expect(box!.scrollable).toBe(true);
    expect(box!.virtualized).toBe(false);
    expect(box!.listItemHeight).toBe(0);
  });
});

describe("canvas node model", () => {
  it("lowers <canvas> to a node with kind 'canvas' and buffer dims", () => {
    const styled = resolveStyles(parseHtml(`<screen><canvas id="spark" width="120" height="40"></canvas></screen>`), parseCss(``));
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 240, h: 320 }, measure);
    const program = lowerUIToModel(styled, boxes, "rgb565");
    const canvas = program.nodes.find(n => n.tag === "canvas");
    expect(canvas).toBeDefined();
    expect(canvas!.kind).toBe("canvas");
    expect(canvas!.box).toMatchObject({ w: 120, h: 40 });
    expect(canvas!.canvasW).toBe(120);
    expect(canvas!.canvasH).toBe(40);
  });
});

describe("text-decoration and text-overflow lowering", () => {
  // Regression: the regexes in textDecorationOf/textOverflowOf were corrupted
  // with backspace (0x08) bytes, so every value mapped to 0/false.
  it("maps text-decoration: underline to underline=1", () => {
    const html = `<screen><p id="u" style="text-decoration: underline">u</p></screen>`;
    const styled = resolveStyles(parseHtml(html), parseCss(``));
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
    const prog = lowerUIToModel(styled, boxes, "rgb565");
    const u = prog.nodes.find(n => n.id === "u");
    expect(u!.underline).toBe(1);
  });

  it("maps text-decoration: line-through to underline=2", () => {
    const html = `<screen><p id="s" style="text-decoration: line-through">s</p></screen>`;
    const styled = resolveStyles(parseHtml(html), parseCss(``));
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
    const prog = lowerUIToModel(styled, boxes, "rgb565");
    const s = prog.nodes.find(n => n.id === "s");
    expect(s!.underline).toBe(2);
  });

  it("maps text-overflow: ellipsis to textOverflow=true", () => {
    const html = `<screen><p id="e" style="text-overflow: ellipsis">e</p></screen>`;
    const styled = resolveStyles(parseHtml(html), parseCss(``));
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
    const prog = lowerUIToModel(styled, boxes, "rgb565");
    const e = prog.nodes.find(n => n.id === "e");
    expect(e!.textOverflow).toBe(true);
  });
});

describe("visibility lowering", () => {
  // Regression: model.ts only checked visibility === "hidden", so
  // visibility: collapse was treated as visible and the element rendered.
  it("visibility: collapse lowers to visible=false (treated like hidden)", () => {
    const html = `<screen><div id="c" style="visibility: collapse"></div></screen>`;
    const styled = resolveStyles(parseHtml(html), parseCss(``));
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
    const prog = lowerUIToModel(styled, boxes, "rgb565");
    const c = prog.nodes.find(n => n.id === "c");
    expect(c!.visible).toBe(false);
  });

  it("visibility: hidden lowers to visible=false", () => {
    const html = `<screen><div id="h" style="visibility: hidden"></div></screen>`;
    const styled = resolveStyles(parseHtml(html), parseCss(``));
    const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
    const prog = lowerUIToModel(styled, boxes, "rgb565");
    const h = prog.nodes.find(n => n.id === "h");
    expect(h!.visible).toBe(false);
  });
});
