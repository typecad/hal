import { describe, expect, it } from "vitest";
import { resolveColor } from "@typecad/ui/ui-engine/color";
import { PreviewUIRuntime } from "@typecad/ui/preview/host-ui-runtime";
import { buildUiFixture, collectLayoutProblems } from "./ui-layout-harness";

function px(buffer: Uint16Array, width: number, x: number, y: number): number {
  return buffer[y * width + x];
}

function countColor(buffer: Uint16Array, width: number, x: number, y: number, w: number, h: number, color: number): number {
  let count = 0;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (buffer[yy * width + xx] === color) count++;
    }
  }
  return count;
}

// These tests prove supported selector forms travel through parser -> resolver ->
// layout -> model/render paths without being dropped or corrupting layout. They
// intentionally characterize current behavior; they are not visual approval for
// every selector/property combination.
describe("UI layout harness", () => {
  it("removes display none and hidden subtrees from flex flow while preserving nodes", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="first"></view>
          <view id="gone"><view id="insideGone"></view></view>
          <view id="attrHidden" hidden></view>
          <view id="last"></view>
        </screen>
      `,
      css: `
        screen { display: flex; flex-direction: column; }
        #first, #last { width: 20px; height: 20px; background: #00ff00; }
        #gone { display: none; width: 20px; height: 80px; background: #ff0000; }
        #insideGone { width: 20px; height: 30px; background: #0000ff; }
        #attrHidden { width: 20px; height: 40px; background: #ffff00; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);
    expect(ui.node("first").box).toMatchObject({ y: 0, w: 20, h: 20 });
    expect(ui.node("gone").box).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(ui.node("insideGone").box).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(ui.node("attrHidden").box).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(ui.node("last").box).toMatchObject({ y: 20, w: 20, h: 20 });
    expect(ui.node("gone").visible).toBe(false);
    expect(ui.node("attrHidden").visible).toBe(false);
    expect(ui.node("last").index).toBe(5);
  });

  it("applies aspect ratio in flex layout", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="wide"></view>
          <view id="tall"></view>
        </screen>
      `,
      css: `
        screen { display: flex; flex-direction: column; }
        #wide { width: 160px; aspect-ratio: 16 / 9; background: #00ff00; }
        #tall { height: 40px; aspect-ratio: 3 / 2; background: #0000ff; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);
    expect(ui.node("wide").box).toMatchObject({ w: 160, h: 90 });
    expect(ui.node("tall").box).toMatchObject({ y: 90, w: 60, h: 40 });
  });

  describe("supported selector matrix", () => {
    const green = resolveColor("#00ff00", "rgb565");
    const white = resolveColor("#ffffff", "rgb565");

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

    it("matches tag-id-class compounds with hyphenated and underscored names", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <button id="save-now" class="primary_2 compact">Save</button>
            <button id="delete-now" class="danger-button compact">Delete</button>
            <text id="status_text" class="primary_2">Status</text>
            <text id="plain_text" class="compact">Plain</text>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          button, text { color: #ffffff; }
          button#save-now.primary_2 { color: #00ff00; }
          #delete-now.danger-button { color: #ff0000; }
          .primary_2#status_text { color: #0000ff; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.node("save-now").fg).toBe(resolveColor("#00ff00", "rgb565"));
      expect(ui.node("delete-now").fg).toBe(resolveColor("#ff0000", "rgb565"));
      expect(ui.node("status_text").fg).toBe(resolveColor("#0000ff", "rgb565"));
      expect(ui.node("plain_text").fg).toBe(resolveColor("#ffffff", "rgb565"));
    });

    it.each([
      { selector: "#target", peerMatches: false },
      { selector: ".alpha", peerMatches: false },
      { selector: ".beta", peerMatches: false },
      { selector: ".name-with-dash", peerMatches: false },
      { selector: ".name_with_underscore", peerMatches: false },
      { selector: "button.alpha", peerMatches: false },
      { selector: "button#target", peerMatches: false },
      { selector: "#target.alpha", peerMatches: false },
      { selector: ".alpha#target", peerMatches: false },
      { selector: ".alpha.beta", peerMatches: false },
      { selector: ".beta.alpha", peerMatches: false },
      { selector: "button.alpha.beta", peerMatches: false },
      { selector: "button#target.alpha.beta", peerMatches: false },
      { selector: "button.beta#target.alpha", peerMatches: false },
      { selector: "button", peerMatches: true },
    ])("matches compound selector '$selector'", ({ selector, peerMatches }) => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <button id="target" class="alpha beta name-with-dash name_with_underscore">Target</button>
            <button id="peer" class="plain">Peer</button>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          button { color: #ffffff; }
          ${selector} { color: #00ff00; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.node("target").fg).toBe(green);
      expect(ui.node("peer").fg).toBe(peerMatches ? green : white);
    });

    it("applies element selectors for every lowered UI node tag", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <view id="view"></view>
            <text id="text">Text</text>
            <button id="button">Button</button>
            <check id="check">Check</check>
            <select id="select"><option value="a">Alpha</option><option value="b">Beta</option></select>
            <radio id="radio" name="group" value="a">Radio</radio>
            <progress id="progress"></progress>
            <range id="range" min="0" max="10"></range>
            <input id="input" type="text" placeholder="Input"></input>
            <img id="img" src="missing.bmp" width="12" height="12"></img>
            <list id="list" item-height="16"></list>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; color: #101010; }
          view { color: #111111; width: 12px; height: 12px; }
          text { color: #222222; }
          button { color: #333333; }
          check { color: #444444; }
          select { color: #555555; }
          radio { color: #666666; }
          progress { color: #777777; }
          range { color: #888888; }
          input { color: #999999; }
          img { color: #aaaaaa; }
          list { color: #bbbbbb; width: 12px; height: 16px; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      for (const [id, color] of [
        ["view", "#111111"],
        ["text", "#222222"],
        ["button", "#333333"],
        ["check", "#444444"],
        ["select", "#555555"],
        ["radio", "#666666"],
        ["progress", "#777777"],
        ["range", "#888888"],
        ["input", "#999999"],
        ["img", "#aaaaaa"],
        ["list", "#bbbbbb"],
      ] as const) {
        expect(ui.node(id).fg).toBe(resolveColor(color, "rgb565"));
      }
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

    it("keeps descendant selector ancestry ordered", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <view id="outer" class="outer">
              <view id="middle" class="middle">
                <text id="ordered" class="target">Ordered</text>
              </view>
            </view>
            <view id="wrongOrderMiddle" class="middle">
              <view id="wrongOrderOuter" class="outer">
                <text id="wrongOrder" class="target">Wrong</text>
              </view>
            </view>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          .target { color: #ffffff; }
          .outer .middle .target { color: #00ff00; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.node("ordered").fg).toBe(resolveColor("#00ff00", "rgb565"));
      expect(ui.node("wrongOrder").fg).toBe(resolveColor("#ffffff", "rgb565"));
    });

    it.each([
      "screen button",
      "#root #target",
      ".shell .target",
      "screen.shell button.target",
      "screen#root.shell view#panel.card button#target.target.primary",
      ".shell .card .primary.target",
      "#root view.card .target",
    ])("matches descendant selector chain '%s'", (selector) => {
      const ui = buildUiFixture({
        html: `
          <screen id="root" class="shell">
            <view id="panel" class="card">
              <button id="target" class="target primary">Target</button>
            </view>
            <button id="outside" class="target primary">Outside</button>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          button { color: #ffffff; }
          ${selector} { color: #00ff00; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.node("target").fg).toBe(green);
      expect(ui.node("outside").fg).toBe(
        selector === "screen button" || selector === ".shell .target" || selector === "screen.shell button.target"
          ? green
          : white,
      );
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

    it("expands comma lists that mix elements, ids, classes, and compounds", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <text id="headline" class="copy">Headline</text>
            <button id="submit" class="primary action">Submit</button>
            <button id="skip" class="secondary">Skip</button>
            <text id="note" class="note">Note</text>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          text, button { color: #ffffff; }
          #headline, button.primary.action, .note { color: #00ff00; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.node("headline").fg).toBe(resolveColor("#00ff00", "rgb565"));
      expect(ui.node("submit").fg).toBe(resolveColor("#00ff00", "rgb565"));
      expect(ui.node("note").fg).toBe(resolveColor("#00ff00", "rgb565"));
      expect(ui.node("skip").fg).toBe(resolveColor("#ffffff", "rgb565"));
    });

    it("expands comma lists with whitespace and pseudo selectors", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <button id="alpha" class="choice primary">Alpha</button>
            <button id="beta" class="choice secondary">Beta</button>
            <button id="gamma" class="choice">Gamma</button>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          .choice { color: #ffffff; background: #202020; transition: color 40ms; }
          #alpha:pressed,
          button.secondary:active { color: #00ff00; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.program.transitions.find((transition) => transition.node === ui.node("alpha").index)).toMatchObject({
        pressedTarget: green,
      });
      expect(ui.program.transitions.find((transition) => transition.node === ui.node("beta").index)).toMatchObject({
        pressedTarget: green,
      });
      expect(ui.program.transitions.find((transition) => transition.node === ui.node("gamma").index)).toMatchObject({
        pressedTarget: white,
      });
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

    it("supports state selectors on class and compound targets", () => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <button id="pill" class="toggle selected">Toggle</button>
            <button id="plain" class="toggle">Plain</button>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          .toggle { color: #ffffff; background: #202020; transition: color 75ms; }
          .toggle.selected:pressed { color: #00ff00; transform: translate(2px, 1px); }
          button.toggle:active { background: #0000ff; }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);

      const pill = ui.node("pill");
      const plain = ui.node("plain");
      expect(pill.fg).toBe(resolveColor("#ffffff", "rgb565"));
      expect(pill.bg).toBe(resolveColor("#202020", "rgb565"));
      expect(pill.pressedOffsetX).toBe(2);
      expect(pill.pressedOffsetY).toBe(1);
      expect(plain.pressedOffsetX).toBe(0);
      expect(plain.pressedOffsetY).toBe(0);

      expect(ui.program.transitions.find((transition) => transition.node === pill.index)).toMatchObject({
        prop: "color",
        pressedTarget: resolveColor("#00ff00", "rgb565"),
      });
      expect(ui.program.transitions.find((transition) => transition.node === plain.index)).toMatchObject({
        prop: "color",
        pressedTarget: resolveColor("#ffffff", "rgb565"),
      });
    });

    it.each([
      "#target:pressed",
      ".target:pressed",
      "button:pressed",
      "button.target:pressed",
      "#target.target:pressed",
      ".target.primary:pressed",
      "#target:active",
      ".target:active",
      "button.target:active",
    ])("applies pseudo selector '%s'", (selector) => {
      const ui = buildUiFixture({
        html: `
          <screen id="root">
            <button id="target" class="target primary">Target</button>
            <button id="peer" class="peer">Peer</button>
          </screen>
        `,
        css: `
          screen { display: flex; flex-direction: column; }
          button { color: #ffffff; background: #202020; transition: color 25ms; }
          ${selector} { color: #00ff00; transform: translateX(3px); }
        `,
      });

      expect(collectLayoutProblems(ui)).toEqual([]);
      expect(ui.program.transitions.find((transition) => transition.node === ui.node("target").index)).toMatchObject({
        pressedTarget: green,
      });
      expect(ui.node("target").pressedOffsetX).toBe(3);

      const peerTransition = ui.program.transitions.find((transition) => transition.node === ui.node("peer").index);
      expect(peerTransition).toMatchObject({
        pressedTarget: selector === "button:pressed" ? green : white,
      });
      expect(ui.node("peer").pressedOffsetX).toBe(selector === "button:pressed" ? 3 : 0);
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
    // 12px → GFX bucket 1. font-weight:bold no longer adds to the bucket
    // (matches web behavior); previously it bumped 1→2.
    expect(cta.textSize).toBe(1);
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

  it("emits immediate pressed color feedback without a transition declaration", () => {
    const ui = buildUiFixture({
      html: `<screen id="root"><button id="cta">Tap</button></screen>`,
      css: `
        screen { display: flex; }
        #cta { background: #202020; color: #ffffff; padding: 4px; }
        #cta:pressed { background: #00ff00; color: #0000ff; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);

    const cta = ui.node("cta");
    expect(ui.program.transitions).toHaveLength(2);
    expect(ui.program.transitions.find((transition) => transition.prop === "background")).toMatchObject({
      node: cta.index,
      durationMs: 0,
      baseTarget: resolveColor("#202020", "rgb565"),
      pressedTarget: resolveColor("#00ff00", "rgb565"),
    });
    expect(ui.program.transitions.find((transition) => transition.prop === "color")).toMatchObject({
      node: cta.index,
      durationMs: 0,
      baseTarget: resolveColor("#ffffff", "rgb565"),
      pressedTarget: resolveColor("#0000ff", "rgb565"),
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

  it("lays out constrained text as multiple lines with line-height", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <text id="copy">alpha beta gamma</text>
          <text id="breaks">Top<br/>Bottom</text>
        </screen>
      `,
      css: `
        screen { display: flex; flex-direction: column; background: #000000; }
        #copy { width: 60px; font-size: 16px; line-height: 20px; color: #ffffff; }
        #breaks { width: 80px; font-size: 16px; white-space: pre-line; color: #ffffff; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);
    expect(ui.node("copy").box).toMatchObject({ w: 60, h: 60 });
    expect(ui.node("copy")).toMatchObject({ lineHeight: 20, whiteSpaceMode: 0 });
    expect(ui.node("breaks").box.h).toBe(32);
    expect(ui.node("breaks").whiteSpaceMode).toBe(3);
  });

  it("keeps nowrap text on one measured line", () => {
    const ui = buildUiFixture({
      html: `<screen id="root"><text id="copy">alpha beta gamma</text></screen>`,
      css: `
        screen { display: flex; flex-direction: column; }
        #copy { max-width: 60px; font-size: 16px; white-space: nowrap; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);
    expect(ui.node("copy").box.h).toBe(16);
    expect(ui.node("copy").whiteSpaceMode).toBe(1);
  });

  it("tracks wrapped text height in preview and clears old wrapped lines", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <text id="copy">alpha beta gamma</text>
        </screen>
      `,
      css: `
        screen { display: flex; flex-direction: column; background: #000000; }
        #copy { width: 60px; font-size: 16px; line-height: 20px; color: #ffffff; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);

    const runtime = ui.startPreview();
    try {
      const copy = ui.node("copy");
      const black = resolveColor("#000000", "rgb565");
      const secondLineY = copy.box.y + copy.lineHeight;
      const mutableNode = (runtime as any).nodes[copy.index];

      expect(mutableNode.lastTextHeight).toBe(60);

      mutableNode.hasTextBinding = true;
      mutableNode.textBuffer = "alpha";
      mutableNode.dirty = true;
      runtime.tick(16);

      expect(mutableNode.lastTextHeight).toBe(20);
      expect(countColor(runtime.gfx.buffer, ui.program.width, copy.box.x, secondLineY, copy.box.w, 16, black))
        .toBe(copy.box.w * 16);
      expect(px(runtime.gfx.buffer, ui.program.width, copy.box.x + 1, secondLineY + 1)).toBe(black);
    } finally {
      runtime.stop();
    }
  });

  it("renders higher z-index layers above later lower-z siblings", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="overlay"><view id="badge"></view></view>
          <view id="base"></view>
        </screen>
      `,
      css: `
        screen { display: flex; position: relative; background: #000000; }
        #overlay { position: absolute; left: 10px; top: 10px; width: 40px; height: 40px; background: #ff0000; z-index: 10; }
        #badge { width: 16px; height: 16px; background: #ffffff; }
        #base { position: absolute; left: 0px; top: 0px; width: 80px; height: 80px; background: #0000ff; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);
    expect(ui.node("overlay").zIndex).toBe(10);
    expect(ui.node("badge").zIndex).toBe(10);

    const runtime = ui.startPreview();
    try {
      const overlay = ui.node("overlay");
      expect(px(runtime.gfx.buffer, ui.program.width, overlay.box.x + 24, overlay.box.y + 24))
        .toBe(resolveColor("#ff0000", "rgb565"));
      expect(px(runtime.gfx.buffer, ui.program.width, overlay.box.x + 4, overlay.box.y + 4))
        .toBe(resolveColor("#ffffff", "rgb565"));
    } finally {
      runtime.stop();
    }
  });

  it("redraws overlapping higher z-index layers when a lower layer changes", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="base"></view>
          <view id="overlay"></view>
        </screen>
      `,
      css: `
        screen { display: flex; position: relative; background: #000000; }
        #base { position: absolute; left: 0px; top: 0px; width: 80px; height: 80px; background: #0000ff; }
        #overlay { position: absolute; left: 10px; top: 10px; width: 40px; height: 40px; background: #ff0000; z-index: 10; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);

    const runtime = ui.startPreview();
    try {
      const base = ui.node("base");
      const overlay = ui.node("overlay");
      const mutableBase = (runtime as any).nodes[base.index];
      mutableBase.bg = resolveColor("#00ff00", "rgb565");
      (runtime as any).markDirty(base.index);
      runtime.tick(16);

      expect(px(runtime.gfx.buffer, ui.program.width, overlay.box.x + 4, overlay.box.y + 4))
        .toBe(resolveColor("#ff0000", "rgb565"));
    } finally {
      runtime.stop();
    }
  });

  it("hit-tests the topmost z-index layer", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="overlay"></view>
          <view id="base"></view>
        </screen>
      `,
      css: `
        screen { display: flex; position: relative; background: #000000; }
        #overlay { position: absolute; left: 10px; top: 10px; width: 40px; height: 40px; background: #ff0000; z-index: 10; }
        #base { position: absolute; left: 0px; top: 0px; width: 80px; height: 80px; background: #0000ff; }
      `,
    });

    const snapshot = ui.previewSnapshot();
    snapshot.callbacks = [
      { nodeId: "overlay", nodeIndex: ui.node("overlay").index, kind: "click", body: "screen.overlay.value = 7;" },
      { nodeId: "base", nodeIndex: ui.node("base").index, kind: "click", body: "screen.base.value = 3;" },
    ];
    const runtime = new PreviewUIRuntime(snapshot);
    runtime.start();
    try {
      runtime.pointerDown(16, 16);
      runtime.pointerUp();
      expect(runtime.screen.overlay.value).toBe(7);
      expect(runtime.screen.base.value).toBe(0);
    } finally {
      runtime.stop();
    }
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

  it("renders closed rounded border corner joins in the preview framebuffer", () => {
    const ui = buildUiFixture({
      html: `<screen id="root"><view id="box"></view></screen>`,
      css: `
        screen { display: flex; padding: 4px; background: #000000; }
        #box { width: 40px; height: 24px; background: #101010; border: 1px solid #ffffff; border-radius: 4px; }
      `,
    });

    const runtime = ui.startPreview();
    try {
      const box = ui.node("box");
      const white = resolveColor("#ffffff", "rgb565");
      const r = box.borderRadius;
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + r, box.box.y)).toBe(white);
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x, box.box.y + r)).toBe(white);
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + box.box.w - r - 1, box.box.y)).toBe(white);
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + box.box.w - 1, box.box.y + r)).toBe(white);
    } finally {
      runtime.stop();
    }
  });

  it("advances keyframe animations in the preview framebuffer", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="pulse"></view>
        </screen>
      `,
      css: `
        @keyframes pulse {
          0%, 100% { background: #ff0000; }
          50% { background: #00ff00; }
        }
        screen { display: flex; padding: 4px; background: #000000; }
        #pulse { width: 20px; height: 20px; background: #ff0000; animation: pulse 1000ms infinite; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);
    expect(ui.program.keyframeSets).toHaveLength(1);
    expect(ui.program.animations).toHaveLength(1);

    const runtime = ui.startPreview();
    try {
      const pulse = ui.node("pulse");
      const sampleX = pulse.box.x + 2;
      const sampleY = pulse.box.y + 2;

      runtime.tick(484);
      expect(px(runtime.gfx.buffer, ui.program.width, sampleX, sampleY))
        .toBe(resolveColor("#00ff00", "rgb565"));

      runtime.tick(500);
      expect(px(runtime.gfx.buffer, ui.program.width, sampleX, sampleY))
        .toBe(resolveColor("#ff0000", "rgb565"));
    } finally {
      runtime.stop();
    }
  });

  it("animates transform x/y in the preview framebuffer and clears the old location", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="mover"></view>
        </screen>
      `,
      css: `
        @keyframes slide {
          0%, 100% { transform: translate(0px, 0px); }
          50% { transform: translate(20px, 6px); }
        }
        screen { display: flex; padding: 4px; background: #000000; }
        #mover { width: 10px; height: 10px; background: #00ff00; animation: slide 1000ms infinite; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);
    expect(ui.program.keyframeSets[0].stops[1]).toMatchObject({
      transformOffsetX: 20,
      transformOffsetY: 6,
    });

    const runtime = ui.startPreview();
    try {
      const mover = ui.node("mover");
      const oldX = mover.box.x + 2;
      const oldY = mover.box.y + 2;
      const newX = mover.box.x + 20 + 2;
      const newY = mover.box.y + 6 + 2;

      expect(px(runtime.gfx.buffer, ui.program.width, oldX, oldY))
        .toBe(resolveColor("#00ff00", "rgb565"));

      runtime.tick(484);
      expect(px(runtime.gfx.buffer, ui.program.width, oldX, oldY))
        .toBe(resolveColor("#000000", "rgb565"));
      expect(px(runtime.gfx.buffer, ui.program.width, newX, newY))
        .toBe(resolveColor("#00ff00", "rgb565"));
    } finally {
      runtime.stop();
    }
  });

  it("restores parent border pixels when a transformed child moves away from them", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="track">
            <view id="mover"></view>
          </view>
        </screen>
      `,
      css: `
        @keyframes slide {
          0%, 100% { transform: translate(0px, 0px); }
          50% { transform: translate(20px, 8px); }
        }
        screen { display: flex; padding: 4px; background: #000000; }
        #track { width: 40px; height: 28px; background: #000000; border: 1px solid #ffffff; }
        #mover { width: 10px; height: 10px; background: #00ff00; animation: slide 1000ms infinite; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);

    const runtime = ui.startPreview();
    try {
      const track = ui.node("track");
      runtime.tick(484);
      expect(px(runtime.gfx.buffer, ui.program.width, track.box.x, track.box.y))
        .toBe(resolveColor("#ffffff", "rgb565"));
    } finally {
      runtime.stop();
    }
  });

  it("animates left top width and height in the preview framebuffer", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="box"></view>
        </screen>
      `,
      css: `
        @keyframes growMove {
          0%, 100% { left: 0px; top: 0px; width: 10px; height: 10px; }
          50% { left: 18px; top: 6px; width: 22px; height: 14px; }
        }
        screen { display: flex; padding: 4px; background: #000000; }
        #box { width: 10px; height: 10px; background: #00ff00; animation: growMove 1000ms infinite; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);
    expect(ui.program.keyframeSets[0].stops[1]).toMatchObject({
      transformOffsetX: 18,
      transformOffsetY: 6,
      width: 22,
      height: 14,
    });

    const runtime = ui.startPreview();
    try {
      const box = ui.node("box");
      runtime.tick(484);
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + 1, box.box.y + 1))
        .toBe(resolveColor("#000000", "rgb565"));
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + 18 + 20, box.box.y + 6 + 12))
        .toBe(resolveColor("#00ff00", "rgb565"));
    } finally {
      runtime.stop();
    }
  });

  it("applies static percentage translate and scale during model lowering", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="box"></view>
        </screen>
      `,
      css: `
        screen { display: flex; padding: 4px; background: #000000; }
        #box {
          width: 20px;
          height: 10px;
          background: #00ff00;
          transform-origin: left top;
          transform: translateX(50%) scale(2, 1.5);
        }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);
    expect(ui.node("box")).toMatchObject({
      transformOffsetX: 10,
      transformOffsetY: 0,
      rotateDeg: 0,
      box: expect.objectContaining({ w: 40, h: 15 }),
    });
  });

  it("animates percentage translate and scale in the preview framebuffer", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="box"></view>
        </screen>
      `,
      css: `
        @keyframes pctScale {
          0%, 100% { transform: translateX(0%) scale(1); }
          50% { transform: translateX(100%) scale(2); }
        }
        screen { display: flex; padding: 4px; background: #000000; }
        #box {
          width: 10px;
          height: 10px;
          background: #00ff00;
          transform-origin: left top;
          animation: pctScale 1000ms infinite;
        }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);
    expect(ui.program.keyframeSets[0].stops[1]).toMatchObject({
      transformOffsetX: 0,
      translatePctX: 100,
      scaleX: 200,
      scaleY: 200,
    });

    const runtime = ui.startPreview();
    try {
      const box = ui.node("box");
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + 1, box.box.y + 1))
        .toBe(resolveColor("#00ff00", "rgb565"));

      runtime.tick(484);
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + 1, box.box.y + 1))
        .toBe(resolveColor("#000000", "rgb565"));
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + 26, box.box.y + 18))
        .toBe(resolveColor("#00ff00", "rgb565"));
    } finally {
      runtime.stop();
    }
  });

  it("renders quarter-turn fill rotation in the preview framebuffer", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="box"></view>
        </screen>
      `,
      css: `
        @keyframes quarterTurn {
          0%, 24% { transform: rotate(0deg); background: #ff0000; }
          25%, 49% { transform: rotate(90deg); background: #00ff00; }
          50%, 74% { transform: rotate(180deg); background: #0000ff; }
          75%, 100% { transform: rotate(270deg); background: #ffffff; }
        }
        screen { display: flex; padding: 4px; background: #000000; }
        #box {
          width: 10px;
          height: 20px;
          background: #ff0000;
          transform-origin: center;
          animation: quarterTurn 1000ms infinite;
        }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);

    const runtime = ui.startPreview();
    try {
      const box = ui.node("box");
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + 8, box.box.y + 18))
        .toBe(resolveColor("#ff0000", "rgb565"));
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + 18, box.box.y + 8))
        .toBe(resolveColor("#000000", "rgb565"));

      runtime.tick(250);
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + 8, box.box.y + 18))
        .toBe(resolveColor("#000000", "rgb565"));
      expect(px(runtime.gfx.buffer, ui.program.width, box.box.x + 18, box.box.y + 8))
        .toBe(resolveColor("#00ff00", "rgb565"));
    } finally {
      runtime.stop();
    }
  });

  it("renders the final frame when a finite keyframe animation completes before the redraw throttle", () => {
    const ui = buildUiFixture({
      html: `
        <screen id="root">
          <view id="flash"></view>
        </screen>
      `,
      css: `
        @keyframes flash {
          from { background: #ff0000; }
          to { background: #0000ff; }
        }
        screen { display: flex; padding: 4px; background: #000000; }
        #flash { width: 20px; height: 20px; background: #ff0000; animation: flash 50ms 1; }
      `,
    });

    expect(collectLayoutProblems(ui)).toEqual([]);

    const runtime = ui.startPreview();
    try {
      const flash = ui.node("flash");
      const sampleX = flash.box.x + 2;
      const sampleY = flash.box.y + 2;

      runtime.tick(34);
      expect(px(runtime.gfx.buffer, ui.program.width, sampleX, sampleY))
        .toBe(resolveColor("#0000ff", "rgb565"));
    } finally {
      runtime.stop();
    }
  });
});
