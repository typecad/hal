// Stage 2 — mono (1bpp) lowering target tests.
//
// The contract (DISPLAY-TARGETS.md): users author the SAME .ui files; colors
// flatten to 1bpp at build time; full-frame redraw always; the preview shows
// exactly what the panel gets. These tests pin the flattening rules, the
// runtime-header machinery, the 1bpp font/image packers, and the build-time
// warnings.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { deriveCapabilities } from "../../../packages/cuttlefish/src/api/shared/display-capabilities";
import { emitRuntimeHeader } from "../../../packages/ui/src/ui-engine/runtime-header";
import { buildUiFixture } from "./ui-layout-harness";
import { cssCompatDiagnostics } from "../../../packages/ui/src/ui-engine/compat-report";
import { monoImageBits, emitImageTables } from "../../../packages/ui/src/ui-engine/image-assets";
import { buildUIFontAssets } from "../../../packages/ui/src/ui-engine/font-assets";
import { parseCss, parseFontFaces } from "@typecad/ui/ui-engine/css-parser";
import { parseHtml } from "@typecad/ui/ui-engine/html-parser";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";
import { setDisplayProfile, resetDisplayProfile } from "@typecad/cuttlefish/stores/display-profile-store";

const here = path.dirname(fileURLToPath(import.meta.url));
const header = emitRuntimeHeader();

afterEach(() => resetDisplayProfile());

describe("Stage 2 mono: capability derivation", () => {
  it("a bare mono colorFormat derives the mono lowering (no displayClass needed)", () => {
    const caps = deriveCapabilities({ width: 128, height: 64, colorFormat: "mono" });
    expect(caps.nativeFormat).toBe("mono");
    expect(caps.requiresBackingStore).toBe(true);
  });

  it("mono OLED is interactive: immediate refresh, scroll + animation stay on", () => {
    const caps = deriveCapabilities({ width: 128, height: 64, colorFormat: "mono", displayClass: "oled" });
    expect(caps.refreshModel).toBe("immediate");
    expect(caps.features.smoothScroll).toBe(true);
    expect(caps.features.animation).toBe(true);
    expect(caps.features.antialias).toBe(false);
    expect(caps.features.gradients).toBe(false);
    expect(caps.features.opacityBlend).toBe(false);
  });

  it("e-ink stays deferred with motion off (Stage 4's axis)", () => {
    const caps = deriveCapabilities({ width: 128, height: 64, colorFormat: "mono", displayClass: "eink" });
    expect(caps.refreshModel).toBe("deferred-partial");
    expect(caps.features.smoothScroll).toBe(false);
    expect(caps.features.animation).toBe(false);
    expect(caps.requiresBackingStore).toBe(true);
  });

  it("a color TFT still derives the byte-identical default", () => {
    const caps = deriveCapabilities({ width: 320, height: 240, colorFormat: "rgb565" });
    expect(caps.nativeFormat).toBe("rgb565");
    expect(caps.refreshModel).toBe("immediate");
    expect(caps.requiresBackingStore).toBe(false);
  });
});

describe("Stage 2 mono: runtime-header machinery", () => {
  it("carries the full-frame redraw branch gated on UI_FULL_FRAME_REDRAW", () => {
    expect(header).toContain("#if defined(UI_FULL_FRAME_REDRAW)");
    expect(header).toContain("display_fillScreen(__ui_mbg)");
    expect(header).toContain("ui_refresh_add_rect(0, 0, display_width(), display_height())");
    // The color path is preserved verbatim behind the #else.
    expect(header).toMatch(/#else\n  \/\/ Select and seed the framebuffer before scroll compositors run/);
  });

  it("carries the mono scroll clip helper + adapter clip calls", () => {
    expect(header).toContain("ui_mono_scroll_clip");
    expect(header).toContain("display_mono_set_clip(__ui_mcx, __ui_mcy, __ui_mcw, __ui_mch)");
    expect(header).toContain("display_mono_clear_clip()");
  });

  it("carries the :pressed face-inversion field only on mono targets", () => {
    expect(header).toContain("uint8_t monoPressInvert;");
    expect(header).toMatch(/#if defined\(UI_NATIVE_MONO\)[\s\S]*monoPressInvert/);
  });

  it("bypasses the canvas/band machinery under full-frame redraw", () => {
    expect(header).toMatch(/ui_create_canvas_best[\s\S]*#if defined\(UI_FULL_FRAME_REDRAW\)[\s\S]*return nullptr;/);
    expect(header).toMatch(/ui_get_repair_canvas[\s\S]*#if defined\(UI_FULL_FRAME_REDRAW\)/);
    expect(header).toMatch(/ui_should_buffer_paint[\s\S]*#if defined\(UI_FULL_FRAME_REDRAW\)/);
  });

  it("packs 1bpp glyph sampling behind the mono format check", () => {
    expect(header).toMatch(/#if defined\(UI_NATIVE_MONO\)[\s\S]*face->format == 1[\s\S]*0x80u >> \(bit & 7\)/);
    // The UIFontFace format field exists only on mono targets.
    expect(header).toMatch(/#if defined\(UI_NATIVE_MONO\)\n  \/\/ Stage 2 mono[\s\S]*uint8_t format;\n#endif/);
  });

  it("samples mono images through ui_image_pixel (packed bits, MSB-first)", () => {
    expect(header).toContain("static inline UI_COLOR_T ui_image_pixel(const UIImage* img, int32_t idx)");
    expect(header).toMatch(/ui_image_pixel[\s\S]*0x80u >> \(idx & 7\)/);
    // The UIImage data pointer switches type under mono.
    expect(header).toMatch(/#if defined\(UI_NATIVE_MONO\)\nstruct UIImage \{ uint16_t w; uint16_t h; const uint8_t\* data; \};/);
  });
});

describe("Stage 2 mono: flattening rules (2c)", () => {
  const fx = buildUiFixture({
    html: `
      <screen>
        <view id="card">
          <text id="label">Hi</text>
          <button id="btn">OK</button>
        </view>
      </screen>`,
    css: `
      #card {
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.5);
        opacity: 0.6;
        background: linear-gradient(to bottom, #ff0000, #0000ff);
      }
      #label { color: #777777; }
      #btn { background: #111111; color: #eeeeee; }
      #btn:pressed { background: #eeeeee; color: #111111; }
    `,
    viewport: { x: 0, y: 0, w: 128, h: 64 },
    colorFormat: "mono",
  });

  it("border-radius → square", () => {
    expect(fx.node("card").borderRadius).toBe(0);
  });

  it("shadows are dropped (box + text)", () => {
    expect(fx.node("card").shadowCount).toBe(0);
    expect(fx.node("card").textShadowCount).toBe(0);
  });

  it("gradients flatten to the first stop fill", () => {
    expect(fx.node("card").gradientEnabled).toBe(0);
    // First stop #ff0000 → luminance (0.299*255)/255 = 0.299 >= 0.27 → 1.
    expect(fx.node("card").bg).toBe(1);
  });

  it("opacity drops to fully opaque", () => {
    expect(fx.node("card").opacity).toBe(100);
  });

  it("colors resolve to 0/1 by the luminance threshold", () => {
    expect(fx.node("label").fg).toBe(1);    // #777 → luminance 0.47 ≥ 0.27 → white
    expect(fx.node("btn").fg).toBe(1);      // #eee → white
    expect(fx.node("btn").bg).toBe(0);      // #111 → black
  });

  it(":pressed lowers to face inversion, not color transitions", () => {
    expect(fx.node("btn").monoPressInvert).toBe(true);
    expect(fx.program.transitions).toHaveLength(0);
  });

  it("non-pressable nodes don't invert", () => {
    expect(fx.node("card").monoPressInvert).toBeFalsy();
    expect(fx.node("label").monoPressInvert).toBeFalsy();
  });

  it("the preview snapshot carries the mono flattening (preview shows what the panel gets)", () => {
    const snap = fx.previewSnapshot();
    expect(snap.program.colorFormat).toBe("mono");
    const btn = snap.program.nodes.find((n) => n.id === "btn");
    expect((btn as { monoPressInvert?: boolean }).monoPressInvert).toBe(true);
    const card = snap.program.nodes.find((n) => n.id === "card");
    expect(card?.borderRadius).toBe(0);
    expect(card?.shadowCount).toBe(0);
    expect(card?.opacity).toBe(100);
  });
});

describe("Stage 2 mono: build-time warnings", () => {
  const styled = resolveStyles(
    parseHtml(`<screen><view id="v"><text id="t">x</text></view></screen>`),
    parseCss(`
      #v { border-radius: 6px; box-shadow: 0 2px 4px #000; background: linear-gradient(to bottom, #fff, #000); opacity: 0.5; }
      #t { text-shadow: 1px 1px #000; }
    `),
  );
  const diags = cssCompatDiagnostics([styled], [], { width: 128, height: 64 }, "mono", "test.ui.html");
  const codes = diags.map((d) => d.code);

  it("warns for each degenerately flattened construct", () => {
    expect(codes).toContain("css-mono-shadow-dropped");
    expect(codes).toContain("css-mono-gradient-flattened");
    expect(codes).toContain("css-mono-opacity-dropped");
    expect(codes).toContain("css-mono-radius-squared");
  });

  it("does not warn on color targets", () => {
    const colorDiags = cssCompatDiagnostics([styled], [], { width: 320, height: 240 }, "rgb565", "test.ui.html");
    expect(colorDiags.map((d) => d.code)).not.toContain("css-mono-shadow-dropped");
  });
});

describe("Stage 2 mono: 1bpp image packing (2e)", () => {
  // 2x2 image: white, black, #808080 (above threshold), #303030 (below).
  // 565: white 0xffff, black 0x0000, #808080 → (16<<11)|(32<<5)|16 = 0x8410,
  // #303030 → (6<<11)|(12<<5)|6 = 0x3186.
  const asset = {
    id: "t",
    width: 2,
    height: 2,
    data: [0xffff, 0x0000, 0x8410, 0x3186],
  };

  it("threshold mode uses the shared luminance rule (299r+587g+114b >= 68850)", () => {
    // white → 1; black → 0; #808080 (lum ≈ 0.51) → 1; #303030 (lum ≈ 0.19) → 0.
    const bits = monoImageBits(asset, "threshold");
    // One byte holds all 4 pixels (MSB-first): 1,0,1,0 → 0b10100000.
    expect(bits).toEqual([0xa0]);
  });

  it("floyd-steinberg changes at least one mid-tone decision vs threshold", () => {
    // A uniform #808080 field thresholds all-on; FS toggles pixels to
    // preserve the source's average luminance (~0.513 duty on 64 pixels).
    const checker = {
      id: "c",
      width: 8,
      height: 8,
      data: new Array(64).fill(0x8410),
    };
    const thr = monoImageBits(checker, "threshold");
    const fs = monoImageBits(checker, "floyd-steinberg");
    expect(thr.every((b) => b === 0xff)).toBe(true);
    expect(fs).not.toEqual(thr);
    const setBits = fs.reduce((n, b) => n + (b.toString(2).split("").filter((c) => c === "1").length), 0);
    // ~64 * (130826/255000) ≈ 33 expected; allow small integer-drift.
    expect(Math.abs(setBits - 33)).toBeLessThanOrEqual(3);
  });

  it("emits uint8 image tables on mono (packed), not UI_COLOR_T rows", () => {
    const out = emitImageTables([asset as never], "mono");
    expect(out).toContain("static const uint8_t __ui_img_t_data[] = {");
    expect(out).toContain("0xa0");
  });
});

describe("Stage 2 mono: 1bpp glyph packing (2d)", () => {
  const fontPath = path.resolve(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/ui/assets/fonts/dejavu/DejaVuSans.ttf"),
  );

  it("packs glyphs as 1bpp bits with dataOffset counting bits", () => {
    setDisplayProfile({ driver: "solomon,ssd1306", width: 128, height: 64, colorFormat: "mono" } as never, {});
    const css = `@font-face { font-family: "F"; src: url("DejaVuSans.ttf"); } #t { font-family: "F"; font-size: 16px; }`;
    const styled = resolveStyles(parseHtml(`<screen><text id="t">A</text></screen>`), parseCss(css));
    const assets = buildUIFontAssets(styled, parseFontFaces(css), path.dirname(fontPath));
    expect(assets).toHaveLength(1);
    const a = assets[0];
    expect(a.format).toBe("mono1");
    const glyph = a.glyphs.find((g) => g.codepoint === 65 /* A */)!;
    expect(glyph).toBeDefined();
    // 'A' at 16px has real coverage — some bits set, but far fewer than all.
    let setBits = 0;
    const totalBits = glyph.width * glyph.height;
    for (let i = 0; i < totalBits; i++) {
      const bit = glyph.dataOffset + i;
      if (a.alpha[bit >> 3] & (0x80 >> (bit & 7))) setBits++;
    }
    expect(setBits).toBeGreaterThan(10);
    expect(setBits).toBeLessThan(totalBits);
    // Byte budget: the packed stream is at most bits/8 over ALL glyphs of
    // the asset (the face carries the whole fallback charset on mono, not
    // just the sample text's glyphs).
    const totalAssetBits = a.glyphs.reduce((sum, g) => sum + g.width * g.height, 0);
    expect(a.alpha.length).toBeLessThanOrEqual(Math.ceil(totalAssetBits / 8));
  });

  it("keeps alpha4 packing on color targets", () => {
    setDisplayProfile({ driver: "test", width: 320, height: 240, colorFormat: "rgb565" } as never, {});
    const css = `@font-face { font-family: "F"; src: url("DejaVuSans.ttf"); } #t { font-family: "F"; font-size: 16px; }`;
    const styled = resolveStyles(parseHtml(`<screen><text id="t">A</text></screen>`), parseCss(css));
    const assets = buildUIFontAssets(styled, parseFontFaces(css), path.dirname(fontPath));
    expect(assets[0].format).toBe("alpha4");
  });
});
