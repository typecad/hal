import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";
import { deriveCapabilities } from "../../../packages/cuttlefish/src/api/shared/display-capabilities";

describe("SSD1309 OLED display adapter", () => {
  const a = generateDisplayAdapter({
    driver: "ssd1309",
    width: 128,
    height: 64,
    colorFormat: "mono",
    displayClass: "oled",
    rotation: 0,
    _mountCs: 5,
    _mountDc: 21,
    _mountRst: 22,
    _mountBus: "I2C",
    _mountAddress: 0x3C,
    _mountReset: -1,
  } as any);

  it("includes Adafruit_SSD1306 + Wire", () => {
    expect(a.includes).toContain("#include <Adafruit_SSD1306.h>");
    expect(a.includes).toContain("#include <Wire.h>");
  });

  it("declares the display with I2C constructor (width, height, &Wire, reset)", () => {
    expect(a.declaration).toMatch(/Adafruit_SSD1306\s+__tc_display\s*\(\s*128\s*,\s*64\s*,\s*&Wire\s*,\s*-1\s*\)/);
  });

  it("display_init calls begin with SWITCHCAPVCC + address + clearDisplay", () => {
    expect(a.functions).toContain("SSD1306_SWITCHCAPVCC");
    expect(a.functions).toMatch(/begin\(SSD1306_SWITCHCAPVCC,\s*0x3c\)/);
    expect(a.functions).toContain("clearDisplay()");
  });

  it("display_fillScreen packs to 1-bit mono (WHITE/BLACK)", () => {
    expect(a.functions).toContain("SSD1306_WHITE");
    expect(a.functions).toContain("SSD1306_BLACK");
    expect(a.functions).toMatch(/color \? SSD1306_WHITE : SSD1306_BLACK/);
  });

  it("display_partial_refresh calls display() (full page flush)", () => {
    expect(a.functions).toMatch(/__tc_display\.display\(\)/);
  });

  it("startWrite/endWrite/setAddrWindow are no-ops (page-buffered)", () => {
    expect(a.functions).toMatch(/display_startWrite\(\)\s*\{\s*\}/);
    expect(a.functions).toMatch(/display_endWrite\(\)\s*\{\s*\}/);
  });
});

describe("deriveCapabilities for oled displayClass", () => {
  it("produces mono + deferred + backing store for oled + mono", () => {
    const caps = deriveCapabilities({ width: 128, height: 64, colorFormat: "mono", displayClass: "oled" });
    expect(caps.nativeFormat).toBe("mono");
    expect(caps.refreshModel).toBe("deferred-partial");
    expect(caps.requiresBackingStore).toBe(true);
    expect(caps.features.antialias).toBe(false);
  });

  it("still treats eink identically to oled", () => {
    const eink = deriveCapabilities({ width: 128, height: 64, colorFormat: "mono", displayClass: "eink" });
    const oled = deriveCapabilities({ width: 128, height: 64, colorFormat: "mono", displayClass: "oled" });
    expect(eink).toEqual(oled);
  });
});
