declare class Adafruit_GFX {}

export declare class Adafruit_SSD1306 extends Adafruit_GFX {
  constructor(w: number, h: number, twi: number, rst_pin: number, clkDuring: number, clkAfter: number);
  constructor(mosi_pin: number, sclk_pin: number, dc_pin: number, rst_pin: number, cs_pin: number);
  constructor(w: number, h: number, mosi_pin: number, sclk_pin: number, dc_pin: number, rst_pin: number, cs_pin: number);
  constructor(dc_pin: number, rst_pin: number, cs_pin: number);
  constructor(rst_pin: number);
  begin(switchvcc: number, i2caddr: number, reset: boolean, periphBegin: boolean): boolean;
  display(): void;
  clearDisplay(): void;
  invertDisplay(i: boolean): void;
  dim(dim: boolean): void;
  drawPixel(x: number, y: number, color: number): void;
  drawFastHLine(x: number, y: number, w: number, color: number): void;
  drawFastVLine(x: number, y: number, h: number, color: number): void;
  startscrollright(start: number, stop: number): void;
  startscrollleft(start: number, stop: number): void;
  startscrolldiagright(start: number, stop: number): void;
  startscrolldiagleft(start: number, stop: number): void;
  stopscroll(): void;
  ssd1306_command(c: number): void;
  getPixel(x: number, y: number): boolean;
}
