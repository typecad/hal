import { describe, it, expect } from "vitest";
import { ZEPHYR_DISPLAY_PROFILES } from "../../../packages/framework-zephyr/src/display/profiles";
import { zephyrUiDisplayAdapter, zephyrDisplayAdapterGenerator } from "../../../packages/framework-zephyr/src/display/ui-adapter";
import { zephyrTouchAdapter } from "../../../packages/framework-zephyr/src/display/touch-adapter";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src";

// Tests that the Zephyr UI display adapter emits the complete display_*/
// display_target*/display_canvas* surface the UI runtime expects, the
// CuttlefishPanelOps vtable bridging to the panel via the direct-drive SPI
// transport (CS held across command+data), and does NOT #define
// CuttlefishCanvas16 (so the in-tree CuttlefishGFX class slice emits).
describe("Zephyr UI display adapter", () => {
  const profile = ZEPHYR_DISPLAY_PROFILES["st7796-zephyr"];
  const adapter = zephyrUiDisplayAdapter(profile);

  describe("includes", () => {
    it("aliases CuttlefishDisplayTarget to CuttlefishGFX", () => {
      expect(adapter.includes).toMatch(/#define\s+CuttlefishDisplayTarget\s+CuttlefishGFX/);
    });

    it("does NOT #define CuttlefishCanvas16 as a macro (so the native GFX slice emits)", () => {
      // The comment mentions CuttlefishCanvas16, but there must be no #define
      // directive aliasing it (that would suppress the in-tree class slice).
      expect(adapter.includes).not.toMatch(/^#define\s+CuttlefishCanvas16/m);
    });

    it("includes zephyr display + kernel headers", () => {
      expect(adapter.includes).toContain("<zephyr/drivers/display.h>");
      expect(adapter.includes).toContain("<zephyr/kernel.h>");
    });
  });

  describe("declaration", () => {
    it("defines __tc_display_dev as a constant to avoid the ST7796S driver binding", () => {
      // The direct-drive adapter drives the panel via spi_write and deliberately
      // does NOT resolve a Zephyr display device — binding the ST7796S driver
      // allocates a tearing-effect GPIO interrupt that conflicts with the SPI/I2C
      // interrupts. __tc_display_dev is a constant (1) instead of DEVICE_DT_GET.
      expect(adapter.declaration).toMatch(/#define\s+__tc_display_dev\s+1/);
      expect(adapter.declaration).not.toMatch(/DEVICE_DT_GET\(DT_NODELABEL\(display0\)\)/);
    });

    it("declares a one-row 18-bit wire-format scratch buffer", () => {
      expect(adapter.declaration).toMatch(/static uint8_t __tc_display_row3\[\d+ \* 3\]/);
    });

    it("stashes the address window for setAddrWindow/writePixels pairing", () => {
      expect(adapter.declaration).toContain("__tc_aw_x");
      expect(adapter.declaration).toContain("__tc_aw_y");
      expect(adapter.declaration).toContain("__tc_aw_w");
      expect(adapter.declaration).toContain("__tc_aw_h");
    });
  });

  describe("functions — panel-ops vtable bridging to the direct SPI transport", () => {
    it("emits a CuttlefishPanelOps vtable", () => {
      expect(adapter.functions).toMatch(/const CuttlefishPanelOps __tc_display_ops/);
    });

    it("instantiates CuttlefishGFX driven by the ops vtable", () => {
      expect(adapter.functions).toMatch(/CuttlefishGFX __tc_display\(&__tc_display_ops/);
    });

    it("op writePixels streams pixels via the RAMWR burst (spi_write)", () => {
      expect(adapter.functions).toContain("__tc_pnl_ramwr_begin");
      expect(adapter.functions).toContain("__tc_pnl_pixels666");
    });

    it("op fillRect fills row-by-row via the 18-bit scratch buffer", () => {
      expect(adapter.functions).toContain("__tc_pnl_set_window(x, y, rw, rh)");
      expect(adapter.functions).toContain("__tc_display_row3");
    });

    it("packs 565 pixels as 18-bit (R,G,B) bytes for the wire", () => {
      expect(adapter.functions).toContain("static void __tc_pnl_pack666");
      expect(adapter.functions).toContain("(c >> 8) & 0xF8u");
      expect(adapter.functions).toContain("(c << 3) & 0xF8u");
    });
  });

  describe("functions — full adapter surface", () => {
    // The exact display_*/display_target*/display_canvas* symbols the runtime calls.
    const requiredFns = [
      "display_init", "display_fillScreen", "display_defaultTarget",
      "display_width", "display_height",
      "display_startWrite", "display_endWrite", "display_setAddrWindow", "display_writePixels",
      "display_createCanvas", "display_createCanvasPsram", "display_deleteCanvas",
      "display_canvasWidth", "display_canvasHeight", "display_canvasBuffer",
      "display_canvasGetPixel", "display_canvasFillScreen", "display_canvasFillRect",
      "display_targetDrawPixel", "display_targetWidth", "display_targetHeight",
      "display_targetDrawRGBBitmap", "display_targetFillRect",
      "display_targetDrawFastHLine", "display_targetDrawFastVLine",
      "display_targetFillRoundRect", "display_targetDrawRect", "display_targetDrawRoundRect",
      "display_targetDrawLine", "display_targetFillCircle", "display_targetDrawCircle",
      "display_targetSetCursor", "display_targetSetTextColor", "display_targetSetTextColorBg",
      "display_targetSetTextSize", "display_targetSetTextWrap", "display_targetPrint",
    ];

    for (const fn of requiredFns) {
      it(`emits ${fn}`, () => {
        expect(adapter.functions, `missing adapter function: ${fn}`).toContain(fn);
      });
    }

    it("display_createCanvasPsram returns nullptr (no PSRAM on Zephyr)", () => {
      const psramImpl = adapter.functions.match(/display_createCanvasPsram[\s\S]*?\{[\s\S]*?\}/);
      expect(psramImpl, "createCanvasPsram must exist").not.toBeNull();
      expect(psramImpl![0]).toContain("nullptr");
    });
  });

  describe("strategy seam", () => {
    const strat = new ZephyrStrategy();

    it("providesDisplayAdapter returns true", () => {
      expect(strat.providesDisplayAdapter()).toBe(true);
    });

    it("resolveDisplayAdapter returns the adapter for st7796-zephyr", () => {
      const code = strat.resolveDisplayAdapter({
        driver: "st7796-zephyr",
        width: 320, height: 480, colorFormat: "rgb565", rotation: 1,
      } as any);
      expect(code).toBeDefined();
      expect(code!.functions).toContain("display_init");
    });

    it("resolveDisplayAdapter returns undefined for unknown drivers", () => {
      const code = strat.resolveDisplayAdapter({
        driver: "unknown-driver",
        width: 320, height: 240, colorFormat: "rgb565", rotation: 1,
      } as any);
      expect(code).toBeUndefined();
    });

    it("supportedDisplayDrivers includes both registered profiles", () => {
      const drivers = strat.supportedDisplayDrivers();
      expect(drivers.has("ili9341-zephyr")).toBe(true);
      expect(drivers.has("st7796-zephyr")).toBe(true);
    });
  });
});

describe("Zephyr FT6336U touch adapter", () => {
  const strat = new ZephyrStrategy();

  it("providesTouchAdapter returns true", () => {
    expect(strat.providesTouchAdapter()).toBe(true);
  });

  it("resolveTouchAdapter returns code for FT6336U", () => {
    const code = strat.resolveTouchAdapter({
      library: "FT6336U",
      i2cAddress: 0x38,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    } as any);
    expect(code).toBeDefined();
    expect(code!.functions).toContain("touch_init");
    expect(code!.functions).toContain("touch_isTouched");
    expect(code!.functions).toContain("touch_readRaw");
  });

  it("emits i2c_write_read_dt for the I2C read", () => {
    const code = zephyrTouchAdapter({
      library: "FT6336U",
      i2cAddress: 0x38,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    } as any)!;
    expect(code.functions).toContain("i2c_write_read_dt");
  });

  it("resolves the touch device via I2C_DT_SPEC_GET(DT_NODELABEL(ft6336u))", () => {
    const code = zephyrTouchAdapter({
      library: "FT6336U",
      i2cAddress: 0x38,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    } as any)!;
    expect(code.declaration).toMatch(/I2C_DT_SPEC_GET\(DT_NODELABEL\(ft6336u\)\)/);
  });

  it("returns undefined for non-FT6336U libraries", () => {
    const code = zephyrTouchAdapter({
      library: "XPT2046_Touchscreen",
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    } as any);
    expect(code).toBeUndefined();
  });
});
