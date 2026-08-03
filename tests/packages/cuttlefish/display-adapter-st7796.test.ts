import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";
import type { ResolvedDisplay } from "../../../packages/cuttlefish/src/api/shared/display-profile";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";

// The Adafruit ST7796S adapter is strategy-owned (lives in framework-arduino).
const arduino = new ArduinoStrategy();
const gen = (d: ResolvedDisplay) => generateDisplayAdapter(d, arduino);

describe("ST7796S display adapter", () => {
  const base = {
    driver: "st7796",
    width: 320,
    height: 480,
    colorFormat: "rgb565" as const,
    rotation: 1,
    spiFrequency: 80000000,
    _mountCs: 5,
    _mountDc: 17,
    _mountRst: 16,
    _mountBus: "SPI",
    _mountAddress: 0x3C,
    _mountReset: -1,
  };

  const a = gen(base as any);

  it("includes Adafruit_ST7796S (not Adafruit_ST7796)", () => {
    expect(a.includes).toContain("#include <Adafruit_ST7796S.h>");
    expect(a.includes).not.toContain("Adafruit_ST7796.h");
  });

  it("declares Adafruit_ST7796S with CS, DC, RST pins", () => {
    expect(a.declaration).toMatch(
      /Adafruit_ST7796S\s+__tc_display\s*=\s*Adafruit_ST7796S\(5,\s*17,\s*16\)/,
    );
  });

  it("display_init calls init(320,480,0,0,ST7796S_RGB), then setSPISpeed(freq), then setRotation", () => {
    expect(a.functions).toContain(
      "__tc_display.init(320, 480, 0, 0, ST7796S_RGB);",
    );
    expect(a.functions).toMatch(/__tc_display\.setSPISpeed\(80000000\)/);
    expect(a.functions).toMatch(/__tc_display\.setRotation\(1\)/);

    const initIdx = a.functions.indexOf("__tc_display.init(");
    const setSpiSpeedIdx = a.functions.indexOf("__tc_display.setSPISpeed(");
    const rotationIdx = a.functions.indexOf("__tc_display.setRotation(");
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(setSpiSpeedIdx).toBeGreaterThan(initIdx);
    expect(rotationIdx).toBeGreaterThan(setSpiSpeedIdx);
  });

  it("can force ST7796 panel inversion off after init", () => {
    const noInvert = gen({
      ...base,
      invertDisplay: false,
    } as any);

    expect(noInvert.functions).toContain("__tc_display.startWrite();");
    expect(noInvert.functions).toContain("__tc_display.writeCommand(ST77XX_INVOFF);");
    expect(noInvert.functions).toContain("__tc_display.endWrite();");

    const initIdx = noInvert.functions.indexOf("__tc_display.init(");
    const invertOffIdx = noInvert.functions.indexOf("ST77XX_INVOFF");
    const rotationIdx = noInvert.functions.indexOf("__tc_display.setRotation(");
    expect(invertOffIdx).toBeGreaterThan(initIdx);
    expect(rotationIdx).toBeGreaterThan(invertOffIdx);
  });

  it("can force ST7796 panel inversion on when requested", () => {
    const invert = gen({
      ...base,
      invertDisplay: true,
    } as any);

    expect(invert.functions).toContain("__tc_display.writeCommand(ST77XX_INVON);");
  });

  it("can select BGR panel color order", () => {
    const bgr = gen({
      ...base,
      colorOrder: "bgr",
    } as any);

    expect(bgr.functions).toContain(
      "__tc_display.init(320, 480, 0, 0, ST7796S_BGR);",
    );
  });

  it("does NOT emit the unrunnable 18-bit SPI.writeBytes pack loop", () => {
    expect(a.functions).not.toContain("SPI.writeBytes");
  });

  it("has full canvas shim parity with ILI9341", () => {
    expect(a.functions).toContain("display_createCanvas(");
    expect(a.functions).toContain("display_createCanvasPsram(");
    expect(a.functions).toContain("display_deleteCanvas(");
    expect(a.functions).toContain("display_canvasWidth(");
    expect(a.functions).toContain("display_canvasHeight(");
    expect(a.functions).toContain("display_canvasBuffer(");
    expect(a.functions).toContain("display_canvasGetPixel(");
    expect(a.functions).toContain("display_canvasFillScreen(");
    expect(a.functions).toContain("display_canvasFillRect(");
  });

  it("has full target draw-op parity with ILI9341", () => {
    expect(a.functions).toContain("display_targetDrawPixel(");
    expect(a.functions).toContain("display_targetWidth(");
    expect(a.functions).toContain("display_targetHeight(");
    expect(a.functions).toContain("display_targetDrawRGBBitmap(");
    expect(a.functions).toContain("display_targetFillRect(");
    expect(a.functions).toContain("display_targetDrawFastHLine(");
    expect(a.functions).toContain("display_targetDrawFastVLine(");
    expect(a.functions).toContain("display_targetFillRoundRect(");
    expect(a.functions).toContain("display_targetDrawRect(");
    expect(a.functions).toContain("display_targetDrawRoundRect(");
    expect(a.functions).toContain("display_targetDrawLine(");
    expect(a.functions).toContain("display_targetFillCircle(");
    expect(a.functions).toContain("display_targetDrawCircle(");
    expect(a.functions).toContain("display_targetSetCursor(");
    expect(a.functions).toContain("display_targetSetTextColor(");
    expect(a.functions).toContain("display_targetSetTextColorBg(");
    expect(a.functions).toContain("display_targetSetTextSize(");
    expect(a.functions).toContain("display_targetSetTextWrap(");
    expect(a.functions).toContain("display_targetPrint(");
  });

  it("throws a clear error when rgb666 is requested (library hardcodes 565)", () => {
    expect(() =>
      gen({ ...base, colorFormat: "rgb666" } as any),
    ).toThrow(/rgb666/i);
    expect(() =>
      gen({ ...base, colorFormat: "rgb666" } as any),
    ).toThrow(/Adafruit_ST7796S/i);
  });

  it("omits the explicit setSPISpeed(freq) call when spiFrequency is unset", () => {
    const noFreq = gen({
      ...base,
      spiFrequency: undefined,
    } as any);
    expect(noFreq.functions).not.toMatch(/__tc_display\.setSPISpeed\(\d+\)/);
    expect(noFreq.functions).toContain(
      "__tc_display.init(320, 480, 0, 0, ST7796S_RGB);",
    );
  });
});
