declare class Print {}

export declare class Adafruit_GFX extends Print {
  constructor(w: number, h: number);
  startWrite(): void;
  writePixel(x: number, y: number, color: number): void;
  writeFillRect(x: number, y: number, w: number, h: number, color: number): void;
  writeFastVLine(x: number, y: number, h: number, color: number): void;
  writeFastHLine(x: number, y: number, w: number, color: number): void;
  writeLine(x0: number, y0: number, x1: number, y1: number, color: number): void;
  endWrite(): void;
  setRotation(r: number): void;
  invertDisplay(i: boolean): void;
  drawFastVLine(x: number, y: number, h: number, color: number): void;
  drawFastHLine(x: number, y: number, w: number, color: number): void;
  fillRect(x: number, y: number, w: number, h: number, color: number): void;
  fillScreen(color: number): void;
  drawLine(x0: number, y0: number, x1: number, y1: number, color: number): void;
  drawRect(x: number, y: number, w: number, h: number, color: number): void;
  drawCircle(x0: number, y0: number, r: number, color: number): void;
  drawCircleHelper(x0: number, y0: number, r: number, cornername: number, color: number): void;
  fillCircle(x0: number, y0: number, r: number, color: number): void;
  fillCircleHelper(x0: number, y0: number, r: number, cornername: number, delta: number, color: number): void;
  drawEllipse(x0: number, y0: number, rw: number, rh: number, color: number): void;
  fillEllipse(x0: number, y0: number, rw: number, rh: number, color: number): void;
  drawTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, color: number): void;
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, color: number): void;
  drawRoundRect(x0: number, y0: number, w: number, h: number, radius: number, color: number): void;
  fillRoundRect(x0: number, y0: number, w: number, h: number, radius: number, color: number): void;
  drawRotatedRect(cenX: number, cenY: number, w: number, h: number, angleDeg: number, color: number): void;
  fillRotatedRect(cenX: number, cenY: number, w: number, h: number, angleDeg: number, color: number): void;
  rotatePoint(x0: number, y0: number, angleDeg: number): void;
  drawBitmap(x: number, y: number, bitmap: number, w: number, h: number, color: number): void;
  drawBitmap(x: number, y: number, bitmap: number, w: number, h: number, color: number, bg: number): void;
  drawBitmap(x: number, y: number, bitmap: number, w: number, h: number, color: number): void;
  drawBitmap(x: number, y: number, bitmap: number, w: number, h: number, color: number, bg: number): void;
  drawXBitmap(x: number, y: number, bitmap: number, w: number, h: number, color: number): void;
  drawGrayscaleBitmap(x: number, y: number, bitmap: number, w: number, h: number): void;
  drawGrayscaleBitmap(x: number, y: number, bitmap: number, w: number, h: number): void;
  drawGrayscaleBitmap(x: number, y: number, bitmap: number, mask: number, w: number, h: number): void;
  drawGrayscaleBitmap(x: number, y: number, bitmap: number, mask: number, w: number, h: number): void;
  drawRGBBitmap(x: number, y: number, bitmap: number, w: number, h: number): void;
  drawRGBBitmap(x: number, y: number, bitmap: number, w: number, h: number): void;
  drawRGBBitmap(x: number, y: number, bitmap: number, mask: number, w: number, h: number): void;
  drawRGBBitmap(x: number, y: number, bitmap: number, mask: number, w: number, h: number): void;
  drawChar(x: number, y: number, c: any, color: number, bg: number, size: number): void;
  drawChar(x: number, y: number, c: any, color: number, bg: number, size_x: number, size_y: number): void;
  getTextBounds(string: number, x: number, y: number, x1: number, y1: number, w: number, h: number): void;
  getTextBounds(s: number, x: number, y: number, x1: number, y1: number, w: number, h: number): void;
  getTextBounds(str: string, x: number, y: number, x1: number, y1: number, w: number, h: number): void;
  setTextSize(s: number): void;
  setTextSize(sx: number, sy: number): void;
  setFont(f: number): void;
  setCursor(x: number, y: number): void;
  setTextColor(c: number): void;
  setTextColor(c: number, bg: number): void;
  setTextWrap(w: boolean): void;
  cp437(x: boolean): void;
  write(): any;
  width(): number;
  height(): number;
  getRotation(): number;
  getCursorX(): number;
  getCursorY(): number;
}
export declare class Adafruit_GFX_Button {
  constructor();
  initButton(gfx: number, x: number, y: number, w: number, h: number, outline: number, fill: number, textcolor: number, label: number, textsize: number): void;
  initButton(gfx: number, x: number, y: number, w: number, h: number, outline: number, fill: number, textcolor: number, label: number, textsize_x: number, textsize_y: number): void;
  initButtonUL(gfx: number, x1: number, y1: number, w: number, h: number, outline: number, fill: number, textcolor: number, label: number, textsize: number): void;
  initButtonUL(gfx: number, x1: number, y1: number, w: number, h: number, outline: number, fill: number, textcolor: number, label: number, textsize_x: number, textsize_y: number): void;
  drawButton(inverted: boolean): void;
  contains(x: number, y: number): boolean;
  press(p: boolean): void;
  justPressed(): boolean;
  justReleased(): boolean;
  isPressed(): boolean;
}
export declare class GFXcanvas1 extends Adafruit_GFX {
  constructor(w: number, h: number, allocate_buffer: boolean);
  constructor();
  drawPixel(x: number, y: number, color: number): void;
  fillScreen(color: number): void;
  drawFastVLine(x: number, y: number, h: number, color: number): void;
  drawFastHLine(x: number, y: number, w: number, color: number): void;
  getPixel(x: number, y: number): boolean;
}
export declare class GFXcanvas8 extends Adafruit_GFX {
  constructor(w: number, h: number, allocate_buffer: boolean);
  constructor();
  drawPixel(x: number, y: number, color: number): void;
  fillScreen(color: number): void;
  drawFastVLine(x: number, y: number, h: number, color: number): void;
  drawFastHLine(x: number, y: number, w: number, color: number): void;
  getPixel(x: number, y: number): number;
}
export declare class GFXcanvas16 extends Adafruit_GFX {
  constructor(w: number, h: number, allocate_buffer: boolean);
  constructor();
  drawPixel(x: number, y: number, color: number): void;
  fillScreen(color: number): void;
  byteSwap(): void;
  drawFastVLine(x: number, y: number, h: number, color: number): void;
  drawFastHLine(x: number, y: number, w: number, color: number): void;
  getPixel(x: number, y: number): number;
}
