import { describe, expect, it } from "vitest";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { measure } from "@typecad/cuttlefish/ui/layout-engine";
import { lowerUIToModel } from "@typecad/cuttlefish/ui/model";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
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
});
