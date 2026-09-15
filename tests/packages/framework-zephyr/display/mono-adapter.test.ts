// Stage 2 — mono (1bpp) lowering target on the Zephyr framework side:
// the full-frame adapter, the vtiled packing fix in the direct-op runtime,
// drop-in mono synthesis, and the no-longer-declined UI path.
import { describe, expect, it } from "vitest";
import { zephyrMonoDisplayAdapter } from "../../../../packages/framework-zephyr/src/display/ui-adapter-mono";
import { zephyrDisplayAdapterGenerator } from "../../../../packages/framework-zephyr/src/display/ui-adapter";
import { buildDisplayRuntime } from "../../../../packages/framework-zephyr/src/display/gfx";
import {
  ZEPHYR_DISPLAY_PROFILES,
  synthesizeZephyrProfile,
  isMonoDisplay,
} from "../../../../packages/framework-zephyr/src/display/profiles";
import { resolveZephyrDisplayOp, newDisplayState } from "../../../../packages/framework-zephyr/src/display/index";

const SSD1306 = ZEPHYR_DISPLAY_PROFILES["ssd1306-zephyr"];

describe("mono UI adapter (Stage 2)", () => {
  const code = zephyrMonoDisplayAdapter(SSD1306);

  it("targets the ZephyrMonoTarget, not the rgb565 panel-ops path", () => {
    expect(code.includes).toContain("#define CuttlefishDisplayTarget ZephyrMonoTarget");
    expect(code.functions).toContain("class ZephyrMonoTarget final : public CuttlefishGFX");
  });

  it("keeps a vtiled MONO01 backing store (byte = 8 vertical pixels)", () => {
    expect(code.declaration).toContain("__tc_mono_fb[(128 * 64 + 7) / 8]");
    expect(code.functions).toMatch(/__tc_mono_fb\[\(static_cast<uint32_t>\(y\) >> 3\) \* 128u \+ static_cast<uint32_t>\(x\)\]/);
    expect(code.functions).toContain("1u << (y & 7)");
  });

  it("pushes ONE full-frame display_write with pitch == width", () => {
    // The ssd1306 driver rejects pitch != width and (height & 7) != 0.
    expect(code.functions).toMatch(/__desc\.pitch = 128u/);
    expect(code.functions).toMatch(/__desc\.height = 64u/);
    expect(code.functions).toMatch(/display_write\(__tc_zd_dev, 0, 0, &__desc, src\)/);
    // Full-frame always: the dirty-rect args are voided.
    expect(code.functions).toMatch(/display_partial_refresh\(int16_t x, int16_t y, int16_t rw, int16_t rh\)[\s\S]*\(void\)x; \(void\)y; \(void\)rw; \(void\)rh;/);
  });

  it("provides the runtime's mono clip API and enforces it in the primitives", () => {
    expect(code.functions).toContain("static inline void display_mono_set_clip(");
    expect(code.functions).toContain("static inline void display_mono_clear_clip()");
    expect(code.functions).toMatch(/drawPixel[\s\S]*__tc_mono_clip_w > 0/);
  });

  it("requests MONO01 and falls back to inverted pushes on MONO10 panels", () => {
    expect(code.functions).toContain("display_set_pixel_format(__tc_zd_dev, PIXEL_FORMAT_MONO01)");
    expect(code.functions).toContain("__tc_mono_invert = true");
  });

  it("defines the adapter surface the runtime header links against", () => {
    for (const fn of [
      "display_init()",
      "display_fillScreen(",
      "display_defaultTarget()",
      "display_width()",
      "display_height()",
      "display_partial_refresh(",
    ]) {
      expect(code.functions).toContain(fn);
    }
  });
});

describe("mono dispatch (the decline is gone)", () => {
  it("the generator returns the mono adapter for mono profiles", () => {
    const resolved = { driver: "ssd1306-zephyr" } as never;
    const code = zephyrDisplayAdapterGenerator(resolved);
    expect(code).toBeDefined();
    expect((code as { includes: string }).includes).toContain("ZephyrMonoTarget");
  });

  it("drop-in mono compatibles synthesize mono profiles", () => {
    const synth = synthesizeZephyrProfile({ driver: "solomon,ssd1306", width: 128, height: 64 });
    expect(synth?.colorFormat).toBe("mono");
    expect(isMonoDisplay({ driver: "solomon,ssd1306" })).toBe(true);
    expect(isMonoDisplay({ driver: "solomon,ssd1309" })).toBe(true);
    expect(isMonoDisplay({ driver: "sinowealth,sh1106" })).toBe(true);
    // L8/grayscale panels are Stage 3, not mono.
    expect(isMonoDisplay({ driver: "solomon,ssd1320" })).toBe(false);
    // Explicit colorFormat wins over the compatible table.
    expect(isMonoDisplay({ driver: "solomon,ssd1306", colorFormat: "rgb565" })).toBe(false);
  });

  it("display.init seeds the synthesized mono profile (colorFormat passthrough)", () => {
    const state = newDisplayState();
    resolveZephyrDisplayOp(
      { operation: "display.init", bus: "I2C", cs: 0, dc: 0, rst: 0, width: 128, height: 64, driver: "solomon,ssd1306", colorFormat: "mono" } as never,
      state,
    );
    expect(state.profile.colorFormat).toBe("mono");
    expect(state.profile.width).toBe(128);
  });

  it("drop-in mono compatibles dispatch the mono adapter (not the rgb565 one)", () => {
    // The rig path: driver = DT compatible, engine profile mono (via
    // colorFormatForDriver) — the synthesized profile must take the 1bpp
    // full-frame adapter, never the display-API rgb565 one.
    const code = zephyrDisplayAdapterGenerator({ driver: "solomon,ssd1309", colorFormat: "mono" } as never);
    expect((code as { includes: string }).includes).toContain("ZephyrMonoTarget");
  });

  it("the overlay remuxes i2c0 to the wired sda/scl pins", async () => {
    const { generateOverlay } = await import("../../../../packages/framework-zephyr/src/dt-config/overlay");
    const { TEST_CHIP } = await import("../helpers/test-chip");
    const synth = synthesizeZephyrProfile({ driver: "solomon,ssd1309", width: 128, height: 64, colorFormat: "mono" })!;
    const txt = generateOverlay(
      TEST_CHIP,
      { usesDisplay: true } as never,
      synth,
      { sda: 17, scl: 16, address: 0x3c } as never,
    );
    // Pinctrl group with the named macros for the wired pins, assigned on i2c0.
    expect(txt).toContain("pinmux = <I2C0_SDA_GPIO17>, <I2C0_SCL_GPIO16>;");
    expect(txt).toContain("pinctrl-0 = <&i2c0_display>;");
    expect(txt).toContain("bias-pull-up;");
    expect(txt).toContain("drive-open-drain;");
    // The node names the panel segment of the compatible, at the address.
    expect(txt).toContain("ssd1309@3c");
    expect(txt).toContain('compatible = "solomon,ssd1309"');
    // Default-free required props get upstream-standard values.
    expect(txt).toContain("multiplex-ratio = <63>");
    expect(txt).toContain("prechargep = <0x22>");
    // No remux when no pins are wired.
    const bare = generateOverlay(TEST_CHIP, { usesDisplay: true } as never, synth);
    expect(bare).not.toContain("I2C0_SDA_GPIO");
    expect(bare).not.toContain("pinctrl-0 = <&i2c0_display>");
  });

  it("registered mono profiles keep their registry entry (no synthesis)", () => {
    const state = newDisplayState();
    resolveZephyrDisplayOp(
      { operation: "display.init", bus: "I2C", cs: 0, dc: 0, rst: 0, width: 128, height: 64, driver: "ssd1306-zephyr" } as never,
      state,
    );
    expect(state.profile.driver).toBe("ssd1306-zephyr");
    expect(state.profile.colorFormat).toBe("mono");
  });
});

describe("direct-op mono runtime (gfx.ts) — vtiled fix", () => {
  const rt = buildDisplayRuntime(SSD1306);

  it("packs the framebuffer vtiled (cfb's draw_point layout)", () => {
    expect(rt.helpers).toContain("(static_cast<uint32_t>(y) >> 3) * 128U + x");
    expect(rt.helpers).toContain("1U << (y & 7U)");
  });

  it("flushes with pitch == width and a multiple-of-8 height", () => {
    // The ssd1306 driver's display_write hard-requires these; the old
    // horizontal packing + pitch = rowBytes was rejected with -EINVAL.
    expect(rt.helpers).toMatch(/__desc\.pitch = 128U/);
    expect(rt.helpers).toMatch(/__desc\.height = 64U/);
    expect(rt.helpers).toMatch(/__desc\.width = 128U/);
    expect(rt.helpers).not.toMatch(/__desc\.pitch = 16U/);
  });
});

describe("native_sim mono gate (Stage 2g)", () => {
  const SIM = ZEPHYR_DISPLAY_PROFILES["native-sim-mono"];

  it("targets the board's own sdl_dc node with MONO01 fragments", () => {
    expect(SIM.dtLabel).toBe("sdl_dc");
    expect(SIM.colorFormat).toBe("mono");
    expect(SIM.boardProvidesDisplay).toBe(true);
    expect(SIM.kconfig).toContain("CONFIG_SDL_DISPLAY_DEFAULT_PIXEL_FORMAT_MONO01=y");
  });

  it("the overlay emits no display node for board-provided panels", async () => {
    const { generateOverlay } = await import("../../../../packages/framework-zephyr/src/dt-config/overlay");
    const { TEST_CHIP } = await import("../helpers/test-chip");
    const txt = generateOverlay(TEST_CHIP, { usesDisplay: true } as never, SIM);
    expect(txt).not.toContain("ssd1306@");
    expect(txt).not.toContain("sdl_dc");
    expect(txt).not.toContain("mipi_dbi");
    expect(txt).not.toContain("&spi2");
  });

  it("kconfig appends the profile's fragments without the SPI bridge block", async () => {
    const { resolveKconfigFragments } = await import("../../../../packages/framework-zephyr/src/dt-config/kconfig");
    const m = resolveKconfigFragments({ usesDisplay: true, displayKconfigExtra: SIM.kconfig } as never, false);
    const conf = [...m.entries()].map(([k, v]) => `${k}=${v}`).join("\n");
    expect(conf).toContain("CONFIG_SDL_DISPLAY_DEFAULT_PIXEL_FORMAT_MONO01=y");
    expect(conf).not.toContain("CONFIG_SPI=y");
    expect(conf).not.toContain("CONFIG_MIPI_DBI=y");
  });
});

describe("drop-in mono default (engine-side consistency)", () => {
  it("the strategy answers mono for 1bpp OLED compatibles, default otherwise", async () => {
    const { ZephyrStrategy } = await import("../../../../packages/framework-zephyr/src/strategy");
    const s = new ZephyrStrategy();
    // The engine consults colorFormatForDriver when a drop-in config names a
    // compatible with no explicit colorFormat — both sides must lower mono.
    expect(s.colorFormatForDriver?.("solomon,ssd1306")).toBe("mono");
    expect(s.colorFormatForDriver?.("sinowealth,sh1106")).toBe("mono");
    expect(s.colorFormatForDriver?.("ilitek,ili9341")).toBeUndefined();
    expect(s.colorFormatForDriver?.("ssd1306-zephyr")).toBeUndefined(); // registry profile carries its own
    expect(s.colorFormatForDriver?.("nope")).toBeUndefined();
  });
});
