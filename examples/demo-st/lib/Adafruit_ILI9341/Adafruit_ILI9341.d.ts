import type { Adafruit_SPITFT } from "../Adafruit_GFX_Library/Adafruit_SPITFT";

export declare class Adafruit_ILI9341 extends Adafruit_SPITFT {
  constructor(_CS: number, _DC: number, _MOSI: number, _SCLK: number, _RST: number, _MISO: number);
  constructor(_CS: number, _DC: number, _RST: number);
  constructor(spiClass: number, dc: number, cs: number, rst: number);
  constructor(busWidth: any, d0: number, wr: number, dc: number, cs: number, rst: number, rd: number);
  begin(freq: number): void;
  setRotation(r: number): void;
  invertDisplay(i: boolean): void;
  scrollTo(y: number): void;
  setScrollMargins(top: number, bottom: number): void;
  setAddrWindow(x: number, y: number, w: number, h: number): void;
  readcommand8(reg: number, index: number): number;
}
