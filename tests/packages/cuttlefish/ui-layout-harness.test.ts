import { describe, expect, it } from "vitest";
import { resolveColor } from "@typecad/cuttlefish/ui/color";
import { buildUiFixture, collectLayoutProblems } from "./ui-layout-harness";

function px(buffer: Uint16Array, width: number, x: number, y: number): number {
  return buffer[y * width + x];
}

describe("UI layout harness", () => {
  describe("supported selector matrix", () => {
    it("applies element selectors to every matching element", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <text id="first">One</text>
            <view id="box"></view>
            <text id="second">Two</text>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          text { color: #00ff00; font-size: 12px; }
          view { background: #0000ff; width: 16px; height: 16px; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.node("first").fg).toBe(resolveColor("#00ff00", "rgb565"));
      expect(ui.node("second").fg).toBe(resolveColor("#00ff00", "rgb565"));
      expect(ui.node("box").bg).toBe(resolveColor("#0000ff", "rgb565"));
    });

    it("applies id selectors to one element without leaking to peers", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <button id="save">Save</button>
            <button id="cancel">Cancel</button>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          button { color: #ffffff; background: #202020; }
          #save { color: #00ff00; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.node("save").fg).toBe(resolveColor("#00ff00", "rgb565"));
      expect(ui.node("cancel").fg).toBe(resolveColor("#ffffff", "rgb565"));
    });

    it("applies class selectors across element types", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <text id="title" class="accent">Title</text>
            <button id="action" class="accent">Go</button>
            <text id="plain">Plain</text>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          text, button { color: #ffffff; }
          .accent { color: #ff0000; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.node("title").fg).toBe(resolveColor("#ff0000", "rgb565"));
      expect(ui.node("action").fg).toBe(resolveColor("#ff0000", "rgb565"));
      expect(ui.node("plain").fg).toBe(resolveColor("#ffffff", "rgb565"));
    });

    it("requires every simple selector in a compound to match", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <button id="primaryButton" class="primary large">Go</button>
            <button id="smallButton" class="primary">Small</button>
            <text id="primaryText" class="primary large">Text</text>
            <text id="idClassTarget" class="featured">Target</text>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          button, text { color: #ffffff; }
          button.primary.large { color: #00ff00; }
          text.primary.large { color: #0000ff; }
          #idClassTarget.featured { color: #ff0000; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.node("primaryButton").fg).toBe(resolveColor("#00ff00", "rgb565"));
      expect(ui.node("smallButton").fg).toBe(resolveColor("#ffffff", "rgb565"));
      expect(ui.node("primaryText").fg).toBe(resolveColor("#0000ff", "rgb565"));
      expect(ui.node("idClassTarget").fg).toBe(resolveColor("#ff0000", "rgb565"));
    });

    it("matches descendant selectors through ancestor chains", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root" class="app">
            <view id="panel" class="panel">
              <view id="inner">
                <text id="inside" class="label">Inside</text>
              </view>
            </view>
            <text id="outside" class="label">Outside</text>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          .label { color: #ffffff; }
          screen.app .panel text.label { color: #00ff00; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.node("inside").fg).toBe(resolveColor("#00ff00", "rgb565"));
      expect(ui.node("outside").fg).toBe(resolveColor("#ffffff", "rgb565"));
    });

    it("expands comma-separated selector lists", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <text id="alpha" class="alpha">Alpha</text>
            <button id="beta" class="beta">Beta</button>
            <text id="gamma" class="gamma">Gamma</text>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          text, button { color: #ffffff; }
          .alpha, button.beta { color: #123456; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.node("alpha").fg).toBe(resolveColor("#123456", "rgb565"));
      expect(ui.node("beta").fg).toBe(resolveColor("#123456", "rgb565"));
      expect(ui.node("gamma").fg).toBe(resolveColor("#ffffff", "rgb565"));
    });

    it("keeps :pressed and :active styles separate from base styles", () => {
      const pressed = buildUiFixture({
        html: `<screen id="root"><button id="pressMe">Press</button></screen>`,
        css: `
          screen { display: flex; }
          #pressMe { background: #202020; color: #ffffff; transition: background 50ms; }
          #pressMe:pressed { background: #00ff00; transform: translateX(4px); }
        `,
      });
      const active = buildUiFixture({
        html: `<screen id="root"><button id="activeMe">Active</button></screen>`,
        css: `
          screen { display: flex; }
          #activeMe { background: #202020; color: #ffffff; transition: background 50ms; }
          #activeMe:active { background: #0000ff; transform: translateY(3px); }
        `,
      });

      expect(collectLayoutProblems(pressed)).toEqual([]);
      expect(collectLayoutProblems(active)).toEqual([]);

      expect(pressed.node("pressMe").bg).toBe(resolveColor("#202020", "rgb565"));
      expect(pressed.node("pressMe").pressedOffsetX).toBe(4);
      expect(pressed.program.transitions[0]).toMatchObject({
        pressedTarget: resolveColor("#00ff00", "rgb565"),
      });

      expect(active.node("activeMe").bg).toBe(resolveColor("#202020", "rgb565"));
      expect(active.node("activeMe").pressedOffsetY).toBe(3);
      expect(active.program.transitions[0]).toMatchObject({
        pressedTarget: resolveColor("#0000ff", "rgb565"),
      });
    });
  });

  it("runs key selector forms through style resolution, layout, and model lowering", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root" class="app">
          <view id="card" class="panel primary rounded">
            <button id="cta" class="primary rounded">Go</button>
            <text id="label" class="muted">ready</text>
          </view>
        </screen>
      `,
      css: `
        screen { display: flex; flex-direction: column; padding: 8px; background: #000000; }
        .panel { display: flex; flex-direction: column; gap: 4px; padding: 4px; width: 220px; height: 80px; background: #111111; }
        #card { border: 2px solid #00ff00; }
        .primary.rounded { border-radius: 6px; }
        view.primary button.primary { color: #ff0000; font-size: 12px; font-weight: bold; }
        #label { color: #222222; }
        .panel .muted { color: #123456; text-transform: uppercase; }
        #cta { background: #202020; transition: background 80ms; transform: translateY(1px); }
        #cta:pressed { background: #00ff00; transform: translateY(3px); }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);

    expect(ui.styled("root").style.padding).toBe("8px");
    expect(ui.styled("cta").style.color).toBe("#ff0000");
    expect(ui.styled("label").style.color).toBe("#123456");

    const card = ui.node("card");
    expect(card.bg).toBe(resolveColor("#111111", "rgb565"));
    expect(card.borderStyle).toBe(1);
    expect(card.borderWidth).toBe(2);
    expect(card.borderColor).toBe(resolveColor("#00ff00", "rgb565"));
    expect(card.borderRadius).toBe(6);

    const cta = ui.node("cta");
    expect(cta.fg).toBe(resolveColor("#ff0000", "rgb565"));
    expect(cta.bg).toBe(resolveColor("#202020", "rgb565"));
    expect(cta.textSize).toBe(2);
    expect(cta.transformOffsetY).toBe(1);
    expect(cta.pressedOffsetY).toBe(2);

    const label = ui.node("label");
    expect(label.text).toBe("READY");
    expect(label.fg).toBe(resolveColor("#123456", "rgb565"));

    expect(ui.program.transitions).toHaveLength(1);
    expect(ui.program.transitions[0]).toMatchObject({
      node: cta.index,
      prop: "background",
      durationMs: 80,
      baseTarget: resolveColor("#202020", "rgb565"),
      pressedTarget: resolveColor("#00ff00", "rgb565"),
    });
  });

  it("checks representative flex and scroll layouts for sane boxes and subtree bounds", () => {
    const flex = buildUiFixture({
      html: `
        <screen id="root">
          <view id="row">
            <button id="left">A</button>
            <button id="right">B</button>
          </view>
        </screen>
      `,
      css: `
        screen { display: flex; padding: 6px; background: #000000; }
        #row { display: flex; flex-direction: row; gap: 10px; width: 120px; height: 32px; }
        button { padding: 4px; background: #202020; color: #ffffff; }
      `,
    });

    expect(collectLayoutProblems(flex)).toEqual([]);
    expect(flex.node("left").box.y).toBe(flex.node("right").box.y);
    expect(flex.node("right").box.x).toBeGreaterThanOrEqual(
      flex.node("left").box.x + flex.node("left").box.w + 10,
    );

    const scroll = buildUiFixture({
      html: `
        <screen id="root">
          <view id="body">
            <text id="line1">First</text>
            <text id="line2">Second</text>
            <text id="line3">Third</text>
          </view>
          <text id="footer">Footer</text>
        </screen>
      `,
      css: `
        screen { display: flex; flex-direction: column; padding: 4px; }
        #body { display: flex; flex-direction: column; overflow: scroll; width: 160px; height: 24px; }
        text { font-size: 16px; }
      `,
    });

    expect(collectLayoutProblems(scroll)).toEqual([]);
    expect(scroll.node("body").scrollable).toBe(true);
    expect(scroll.node("body").contentHeight).toBeGreaterThan(scroll.node("body").box.h);
    expect(scroll.node("body").subtreeEnd).toBe(scroll.node("footer").index);
  });

  it("renders a lowered fixture into the preview framebuffer", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="panel">
            <button id="ok">OK</button>
            <progress id="bar"></progress>
          </view>
        </screen>
      `,
      css: `
        screen { display: flex; padding: 4px; background: #001122; }
        #panel { display: flex; flex-direction: column; gap: 6px; width: 140px; height: 70px; padding: 4px; background: #101010; }
        #ok { padding: 4px; background: #00ff00; color: #000000; border: 1px solid #ffffff; }
        #bar { width: 100px; height: 12px; background: #202020; color: #ff0000; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);

    const runtime = ui.startPreview();
    try {
      const root = ui.node("root");
      const ok = ui.node("ok");
      const bar = ui.node("bar");

      expect(px(runtime.gfx.buffer, ui.program.width, root.box.x + 1, root.box.y + 1))
        .toBe(resolveColor("#001122", "rgb565"));
      expect(px(runtime.gfx.buffer, ui.program.width, ok.box.x + 2, ok.box.y + 2))
        .toBe(resolveColor("#00ff00", "rgb565"));

      runtime.screen.bar.value = 50;
      runtime.tick(16);
      expect(px(runtime.gfx.buffer, ui.program.width, bar.box.x + 2, bar.box.y + 2))
        .toBe(resolveColor("#ff0000", "rgb565"));
      expect(px(runtime.gfx.buffer, ui.program.width, bar.box.x + bar.box.w - 2, bar.box.y + 2))
        .toBe(resolveColor("#202020", "rgb565"));
    } finally {
      runtime.stop();
    }
  });
});
