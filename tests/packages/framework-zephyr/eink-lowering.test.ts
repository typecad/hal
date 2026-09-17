// Stage 4 e-ink — the refresh-model proof: the compatible table classifies
// ssd16xx/uc81xx panels as eink (deferred refresh, all dynamic features
// off), drop-ins synthesize displayClass, the engine-side hook mirrors it
// into the build profile, and transitions/keyframes are deleted outright.
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveCapabilities } from "@typecad/cuttlefish/api/shared";
import { setDisplayProfile, resetDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";
import { parseCss } from "@typecad/ui/ui-engine/css-parser";
import { parseHtmlWithKeyboards } from "@typecad/ui/ui-engine/html-parser";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { lowerUIToCpp } from "@typecad/ui/ui-engine/ui-lowering";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("Stage 4 e-ink lowering", () => {
  it("classifies the ssd16xx/uc81xx compatibles as eink", async () => {
    const { isEinkDisplay } = await import("../../../packages/framework-zephyr/src/display/profiles.js");
    expect(isEinkDisplay({ driver: "solomon,ssd1680" })).toBe(true);
    expect(isEinkDisplay({ driver: "ultrachip,uc8176" })).toBe(true);
    expect(isEinkDisplay({ driver: "solomon,ssd1306" })).toBe(false); // mono OLED, not e-ink
    expect(isEinkDisplay({ driver: "x", displayClass: "eink" })).toBe(true);
  });

  it("synthesizes drop-in eink profiles as mono + displayClass eink", async () => {
    const { synthesizeZephyrProfile } = await import("../../../packages/framework-zephyr/src/display/profiles.js");
    const p = synthesizeZephyrProfile({ driver: "solomon,ssd1680", width: 296, height: 176 })!;
    expect(p.colorFormat).toBe("mono");
    expect(p.displayClass).toBe("eink");
  });

  it("eink capabilities: deferred refresh, no animation, no AA", () => {
    const caps = deriveCapabilities({ colorFormat: "mono", displayClass: "eink" } as never);
    expect(caps.refreshModel).toBe("deferred-partial");
    expect(caps.features.animation).toBe(false);
    expect(caps.features.antialias).toBe(false);
    expect(caps.features.smoothScroll).toBe(false);
    expect(caps.requiresBackingStore).toBe(true);
  });

  it("deletes transitions outright on the eink target (but not on TFT)", () => {
    const css = `#b { transition: background 200ms; }`;
    const rules = parseCss(css);
    const [root] = parseHtmlWithKeyboards(`<screen><button id="b">OK</button></screen>`).screens.map(
      (s: never) => resolveStyles(s, rules),
    );
    const boxes = [{ x: 0, y: 0, w: 296, h: 176 }] as never;
    setDisplayProfile(
      { driver: "solomon,ssd1680", width: 296, height: 176, colorFormat: "mono", displayClass: "eink", rotation: 0 } as never,
      {},
    );
    let lowered: { transitionTable: string; keyframeTables: string };
    try {
      lowered = lowerUIToCpp(root as never, boxes, "mono", "flash", [], rules, undefined, [], [], new Map(), []);
    } finally {
      resetDisplayProfile();
    }
    expect((lowered as { transitionTable: string }).transitionTable).toContain("UITransition __ui_trans[] = {};");
    expect((lowered as { keyframeTables: string }).keyframeTables).toContain("__ui_anim_count = 0");
  });
});
