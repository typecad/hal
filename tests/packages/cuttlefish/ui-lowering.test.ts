import { describe, it, expect } from "vitest";
import { lowerUIToCpp } from "@typecad/cuttlefish/ir/transformers/ui-lowering";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import type { KeyboardTemplate } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss, parseKeyframes } from "@typecad/cuttlefish/ui/css-parser";
import { BlockLayoutEngine } from "@typecad/cuttlefish/ui/block-layout";
import { measure } from "@typecad/cuttlefish/ui/layout-engine";
import { buildKeyframeSets } from "@typecad/cuttlefish/ui/keyframes";
import {
  KEYFRAME_PROP_BG,
  KEYFRAME_PROP_FG,
  KEYFRAME_PROP_OPACITY,
  KEYFRAME_PROP_SIZE,
  KEYFRAME_PROP_TRANSFORM,
  lowerUIToModel,
  type KeyframeSetModel,
} from "@typecad/cuttlefish/ui/model";

function lower(html: string, css: string) {
  const styled = resolveStyles(parseHtml(html), parseCss(css));
  const engine = new BlockLayoutEngine();
  const boxes = engine.arrange(styled, { x: 0, y: 0, w: 240, h: 320 }, measure);
  return lowerUIToCpp(styled, boxes, "rgb565", "flash");
}

function keyframeModels(css: string): KeyframeSetModel[] {
  return buildKeyframeSets(parseKeyframes(css), "rgb565");
}

describe("ui lowering", () => {
  it("emits a UINode static array", () => {
    const out = lower(`<screen></screen>`, ``);
    expect(out.nodeTable).toMatch(/UINode\s+__ui_nodes/);
    expect(out.nodeTable).toContain("NODE_FILL");
  });

  it("resolves hex colors to rgb565 in the node table", () => {
    const out = lower(`<screen></screen>`, `screen { background: #008000; }`);
    // #008000 = half green (g=128): (128 & 0xfc) << 3 = 0x0400.
    // (0x07e0 would be pure green #00ff00; see color.test.ts for that case.)
    expect(out.nodeTable).toContain("0x0400");
  });

  it("emits a transition table for transition-able properties", () => {
    const out = lower(
      `<screen><button id="btn">x</button></screen>`,
      `#btn { background: #404040; transition: background 80ms; }`,
    );
    expect(out.transitionTable).toContain("UITransition");
    expect(out.transitionTable).toContain("80");
  });

  it("emits a .ui.d.html.ts with typed id properties", () => {
    const out = lower(
      `<screen><text id="greeting">hi</text><button id="btn">x</button></screen>`,
      `#greeting { font: 8x16; }`,
    );
    expect(out.typeDecl).toContain("greeting");
    expect(out.typeDecl).toContain("btn");
    expect(out.typeDecl).toMatch(/interface|type/);
  });

  it("emits NODE_TEXT for text/button leaves with text payload", () => {
    const out = lower(
      `<screen><text id="greeting">hello world</text></screen>`,
      `#greeting { color: #ff0000; font: 8x16; }`,
    );
    expect(out.nodeTable).toContain("NODE_TEXT");
    expect(out.nodeTable).toContain("hello world");
  });

  it("escapes generated C++ string literals for text payloads", () => {
    const out = lower(
      `<screen><text id="copy">hello<br/>\"quoted\"</text></screen>`,
      `#copy { white-space: pre-line; }`,
    );

    expect(out.nodeTable).toContain(String.raw`hello\n\"quoted\"`);
    expect(out.nodeTable).not.toContain(`hello
"quoted"`);
  });

  it("zero-initializes textBuffer and hasTextBinding in each node row", () => {
    const out = lower(`<screen><text id="greeting">hi</text></screen>`, ``);
    expect(out.nodeTable).toMatch(/\.textBuffer=\{0\}/);
    expect(out.nodeTable).toMatch(/\.hasTextBinding=0/);
  });

  it("emits per-node font antialias flags", () => {
    const out = lower(
      `<screen><text id="smooth">AA</text><text id="bitmap">off</text></screen>`,
      `#smooth { font-smoothing: antialiased; } #bitmap { font-smoothing: none; }`,
    );
    expect(out.nodeTable).toContain(".fontAntialias=1");
    expect(out.nodeTable).toContain(".fontAntialias=0");
  });

  it("emits effective z-index layers", () => {
    const out = lower(
      `<screen><view id="modal"><text id="title">Modal</text></view></screen>`,
      `#modal { z-index: 12; } #title { z-index: 1; }`,
    );
    expect(out.nodeTable).toContain(".zIndex=12");
    expect(out.nodeTable).toContain(".zIndex=13");
  });

  it("lowers image asset ids and object-fit modes", () => {
    const styled = resolveStyles(
      parseHtml(`
        <screen>
          <img id="defaultFit" src="logo.img" width="32" height="32"></img>
          <img id="containFit" src="logo.img" width="32" height="32" style="object-fit: contain"></img>
          <img id="coverFit" src="logo.img" width="32" height="32" style="object-fit: cover"></img>
          <img id="noneFit" src="logo.img" width="32" height="32" style="object-fit: none"></img>
          <img id="scaleDownFit" src="logo.img" width="32" height="32" style="object-fit: scale-down"></img>
        </screen>
      `),
      parseCss(""),
    );
    const boxes = new BlockLayoutEngine().arrange(styled, { x: 0, y: 0, w: 120, h: 120 }, measure);
    const model = lowerUIToModel(styled, boxes, "rgb565", undefined, [], [], new Map([
      ["defaultFit", 0],
      ["containFit", 1],
      ["coverFit", 2],
      ["noneFit", 3],
      ["scaleDownFit", 4],
    ]));

    const byId = (id: string) => model.nodes.find((node) => node.id === id)!;
    expect(byId("defaultFit")).toMatchObject({ imgDataId: 0, objectFit: 1 });
    expect(byId("containFit")).toMatchObject({ imgDataId: 1, objectFit: 2 });
    expect(byId("coverFit")).toMatchObject({ imgDataId: 2, objectFit: 3 });
    expect(byId("noneFit")).toMatchObject({ imgDataId: 3, objectFit: 0 });
    expect(byId("scaleDownFit")).toMatchObject({ imgDataId: 4, objectFit: 4 });
  });

  it("emits generated font tables and assigns a font face id", () => {
    const styled = resolveStyles(
      parseHtml(`<screen><text id="title">A</text></screen>`),
      parseCss(`#title { font-family: "DeviceSans"; font-size: 16px; }`),
    );
    const boxes = new BlockLayoutEngine().arrange(styled, { x: 0, y: 0, w: 80, h: 40 }, measure);
    const out = lowerUIToCpp(styled, boxes, "rgb565", "flash", [], [], undefined, [{
      id: 1,
      family: "DeviceSans",
      sourcePath: "DeviceSans.ttf",
      px: 16,
      fontWeight: "400",
      fontStyle: "normal",
      subset: "exact",
      lineHeight: 18,
      baseline: 14,
      glyphs: [{ codepoint: 65, xOffset: 0, yOffset: -10, width: 2, height: 2, advance: 8, dataOffset: 0 }],
      alpha: [0xff, 0xff],
    } as any]);

    expect(out.nodeTable).toContain(".fontFace=1");
    expect(out.fontTables).toContain("UIFontGlyph");
    expect(out.fontTables).toContain("UIFontFace");
  });

  it("lowers an <input> node to NODE_INPUT with maxlen", () => {
    const out = lower(
      `<screen><input id="ssid" type="text" placeholder="SSID" maxlength="32"></input></screen>`,
      `#ssid { color: lightskyblue; }`,
    );
    expect(out.nodeTable).toContain("NODE_INPUT");
    expect(out.nodeTable).toContain(".maxlen=32");
  });

  it("emits a keyboard loader function and dispatch table for an input", () => {
    const out = lower(
      `<screen><input id="ssid" type="text" placeholder="SSID" maxlength="32"></input></screen>`,
      `#ssid { color: lightskyblue; }`,
    );
    // A loader function named after the default alpha keyboard.
    expect(out.keyboardLoaders).toContain("__ui_kb_load_default_alpha");
    // The dispatch table references it.
    expect(out.keyboardDispatch).toContain("__ui_kb_load_default_alpha");
    expect(out.keyboardDispatch).toContain("__ui_kb_loaders");
  });

  it("selects the numeric default loader for type=number inputs", () => {
    const out = lower(
      `<screen><input id="port" type="number" maxlength="5"></input></screen>`,
      ``,
    );
    expect(out.keyboardLoaders).toContain("__ui_kb_load_default_number");
    expect(out.keyboardDispatch).toContain("__ui_kb_load_default_number");
  });

  it("emits a UIKeyStyle array alongside the key loader", () => {
    const out = lower(
      `<screen><input id="ssid" type="text"></input></screen>`,
      ``,
    );
    expect(out.keyboardLoaders).toContain("ui_kb_add_key");
    expect(out.keyboardLoaders).not.toContain("__ui_kb_keys[__ui_kb_keyCount]");
    expect(out.keyboardLoaders).toContain("__ui_kb_bg");
  });

  it("resolves per-key CSS class rules into key styles", () => {
    const styled = resolveStyles(parseHtml(`<screen><input id="x" keyboard="myKb"></input></screen>`), parseCss(``));
    const boxes = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 20 }];
    const rules = parseCss(`.accent { background: red; color: white; }`);
    const kb: KeyboardTemplate = {
      id: "myKb",
      variant: "alpha",
      classes: ["ui-keyboard"],
      rows: [[{ ch: "a", special: 0, classes: ["accent"] }]],
    };
    const out = lowerUIToCpp(styled, boxes, "rgb565", "flash", [kb], rules);
    // red = #ff0000 → RGB565 0xF800
    expect(out.keyboardLoaders).toContain("0xf800");
  });

  it("emits keyframe stop tables and animation rows", () => {
    const html = `<screen><view id="pulse"></view></screen>`;
    const css = `
      @keyframes pulse {
        0%, 100% { background: #1a6b3c; opacity: 1; transform: translate(0px, 0px); width: 20px; height: 20px; }
        50% { background: #4ade80; opacity: 0.5; color: white; transform: translate(12px, -4px) translateX(50%) scale(1.5, 0.5) rotate(90deg); left: 3px; top: 1px; width: 28px; height: 16px; }
      }
      #pulse { width: 20px; height: 20px; background: #1a6b3c; transform-origin: left top; animation: pulse 2s infinite 100ms; }
    `;
    const styled = resolveStyles(parseHtml(html), parseCss(css));
    const boxes = new BlockLayoutEngine().arrange(styled, { x: 0, y: 0, w: 80, h: 40 }, measure);
    const out = lowerUIToCpp(styled, boxes, "rgb565", "flash", [], parseCss(css), undefined, [], [], new Map(), keyframeModels(css));

    expect(out.keyframeTables).toContain("static const UIKeyframeStop __ui_kf_pulse_stops[]");
    expect(out.keyframeTables).toContain(".percent=50");
    expect(out.keyframeTables).toContain(`.props=${KEYFRAME_PROP_BG | KEYFRAME_PROP_FG | KEYFRAME_PROP_OPACITY | KEYFRAME_PROP_TRANSFORM | KEYFRAME_PROP_SIZE}`);
    expect(out.keyframeTables).toContain(".transformOffsetX=15");
    expect(out.keyframeTables).toContain(".transformOffsetY=-3");
    expect(out.keyframeTables).toContain(".translatePctX=50");
    expect(out.keyframeTables).toContain(".translatePctY=0");
    expect(out.keyframeTables).toContain(".scaleX=150");
    expect(out.keyframeTables).toContain(".scaleY=50");
    expect(out.keyframeTables).toContain(".rotateDeg=90");
    expect(out.keyframeTables).toContain(".width=28");
    expect(out.keyframeTables).toContain(".height=16");
    expect(out.keyframeTables).toContain(".durationMs=2000");
    expect(out.keyframeTables).toContain(".delayMs=100");
    expect(out.keyframeTables).toContain(".iterations=-1");
    expect(out.keyframeTables).toContain(".baseWidth=80");
    expect(out.keyframeTables).toContain(".baseHeight=16");
    expect(out.keyframeTables).toContain(".originX=0");
    expect(out.keyframeTables).toContain(".originY=0");
    expect(out.keyframeTables).toContain("const uint8_t __ui_anim_count = 1");
  });
});
