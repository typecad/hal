import type { Adafruit_GFX } from "./Adafruit_GFX";

export declare class Adafruit_GrayOLED extends Adafruit_GFX {
  constructor(bpp: number, w: number, h: number, twi: number, rst_pin: number, preclk: number, postclk: number);
  constructor(bpp: number, w: number, h: number, mosi_pin: number, sclk_pin: number, dc_pin: number, rst_pin: number, cs_pin: number);
  constructor();
  clearDisplay(): void;
  invertDisplay(i: boolean): void;
  setContrast(contrastlevel: number): void;
  drawPixel(x: number, y: number, color: number): void;
  getPixel(x: number, y: number): boolean;
  oled_command(c: number): void;
  oled_commandList(c: number, n: number): boolean;
}
