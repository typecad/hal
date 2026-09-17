// Stage 3 gray8 — the seam proof: colors become luminance bytes, the
// capability set derives from the format alone (AA returns, keyframes
// impractical), the runtime defines switch UI_COLOR_T to uint8_t with the
// gray blend/lerp bodies, and the Zephyr dispatch synthesizes gray profiles
// for the 16-gray panel compatibles.
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveCapabilities } from "@typecad/cuttlefish/api/shared";
import { rgb888ToGray8, resolveColor, resolveColorInternal } from "@typecad/ui/ui-engine/color";
import { parseCss, parseFontFaces } from "@typecad/ui/ui-engine/css-parser";
import { parseHtmlWithKeyboards } from "@typecad/ui/ui-engine/html-parser";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { buildUIFontAssets } from "@typecad/ui/ui-engine/font-assets";
import { lowerUIToModel } from "@typecad/ui/ui-engine/model";
import { setDisplayProfile, resetDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.resolve(HERE, "../../../packages/ui/assets/fonts/dejavu");

describe("Stage 3 gray8 lowering", () => {
  it("resolves colors to Rec.601 luminance bytes", () => {
    expect(rgb888ToGray8(0x000000)).toBe(0);
    expect(rgb888ToGray8(0xffffff)).toBe(255);
    // Equal-weight gray passes through: 0x808080 → 0x80 = 128.
    expect(rgb888ToGray8(0x808080)).toBe(128);
    expect(resolveColor("#ffffff", "gray8")).toBe(255);
    expect(resolveColorInternal("#404040", "gray8")).toBe(64);
  });

  it("derives the gray8 capability set from the format alone", () => {
    const caps = deriveCapabilities({ colorFormat: "gray8" } as never);
    expect(caps.nativeFormat).toBe("gray8");
    expect(caps.refreshModel).toBe("immediate");
    expect(caps.requiresBackingStore).toBe(true);
    expect(caps.features.antialias).toBe(true);
    expect(caps.features.opacityBlend).toBe(true);
    expect(caps.features.gradients).toBe(false);
    expect(caps.features.animation).toBe(false);
  });

  it("bakes AA glyph assets (alpha4) and gray node colors at lowering", () => {
    setDisplayProfile(
      { driver: "solomon,ssd1327", width: 128, height: 128, colorFormat: "gray8", rotation: 0 } as never,
      {},
    );
    try {
      const css = `
        @font-face { font-family: "G"; src: url("DejaVuSansMono.ttf"); font-weight: 400; }
        #t { font-family: "G"; font-size: 13px; color: #808080; }
      `;
      const rules = parseCss(css);
      const [root] = parseHtmlWithKeyboards(`<screen><text id="t">Ag</text></screen>`).screens.map(
        (s: never) => resolveStyles(s, rules),
      );
      const assets = buildUIFontAssets(root, parseFontFaces(css), FONTS);
      expect(assets[0]!.format).toBe("alpha4"); // AA nibbles survive on gray8
      const boxes = [{ x: 0, y: 0, w: 128, h: 128 }] as never;
      const program = lowerUIToModel(root as never, boxes, "gray8", undefined, assets, [], new Map(), []);
      const text = program.nodes.find((n) => n.kind === "text")!;
      expect(text.fg).toBe(128); // #808080 → luminance byte
      expect((text as unknown as { fontAntialias: boolean }).fontAntialias).toBe(true);
    } finally {
      resetDisplayProfile();
    }
  });

  it("zephyr strategy maps the ssd1327 compatible to gray8", async () => {
    const { isGrayDisplay } = await import("../../../packages/framework-zephyr/src/display/profiles.js");
    expect(isGrayDisplay({ driver: "solomon,ssd1327" })).toBe(true);
    expect(isGrayDisplay({ driver: "solomon,ssd1327", colorFormat: "rgb565" })).toBe(false);
    expect(isGrayDisplay({ driver: "solomon,ssd1306" })).toBe(false);
  });
});
