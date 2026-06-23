export const GFX_FONT_BYTES = 1280;

export interface ImageDataLike {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export function rgb565ToRgb888(color: number): { r: number; g: number; b: number } {
  const r5 = (color >> 11) & 0x1f;
  const g6 = (color >> 5) & 0x3f;
  const b5 = color & 0x1f;
  return {
    r: (r5 << 3) | (r5 >> 2),
    g: (g6 << 2) | (g6 >> 4),
    b: (b5 << 3) | (b5 >> 2),
  };
}

export class HostAdafruitGFX {
  readonly buffer: Uint16Array;
  private cursorX = 0;
  private cursorY = 0;
  private textColor = 0xffff;
  private textBgColor = 0xffff;
  private textSizeX = 1;
  private textSizeY = 1;
  private wrap = true;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly font: Uint8Array = new Uint8Array(GFX_FONT_BYTES),
  ) {
    this.buffer = new Uint16Array(width * height);
  }

  begin(): void {
    // Hardware driver compatibility hook.
  }

  setRotation(_rotation: number): void {
    // The preview framebuffer is already in display-profile coordinates.
  }

  drawPixel(x: number, y: number, color: number): void {
    x = Math.trunc(x);
    y = Math.trunc(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.buffer[y * this.width + x] = color & 0xffff;
  }

  writePixel(x: number, y: number, color: number): void {
    this.drawPixel(x, y, color);
  }

  writeFillRect(x: number, y: number, w: number, h: number, color: number): void {
    this.fillRect(x, y, w, h, color);
  }

  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    x = Math.trunc(x);
    y = Math.trunc(y);
    w = Math.trunc(w);
    h = Math.trunc(h);
    if (w <= 0 || h <= 0) return;

    let x0 = x;
    let y0 = y;
    let x1 = x + w;
    let y1 = y + h;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > this.width) x1 = this.width;
    if (y1 > this.height) y1 = this.height;
    if (x0 >= x1 || y0 >= y1) return;

    const c = color & 0xffff;
    for (let yy = y0; yy < y1; yy++) {
      this.buffer.fill(c, yy * this.width + x0, yy * this.width + x1);
    }
  }

  fillScreen(color: number): void {
    this.buffer.fill(color & 0xffff);
  }

  drawFastHLine(x: number, y: number, w: number, color: number): void {
    this.fillRect(x, y, w, 1, color);
  }

  writeFastHLine(x: number, y: number, w: number, color: number): void {
    this.drawFastHLine(x, y, w, color);
  }

  drawFastVLine(x: number, y: number, h: number, color: number): void {
    this.fillRect(x, y, 1, h, color);
  }

  writeFastVLine(x: number, y: number, h: number, color: number): void {
    this.drawFastVLine(x, y, h, color);
  }

  drawRect(x: number, y: number, w: number, h: number, color: number): void {
    if (w <= 0 || h <= 0) return;
    this.drawFastHLine(x, y, w, color);
    this.drawFastHLine(x, y + h - 1, w, color);
    this.drawFastVLine(x, y, h, color);
    this.drawFastVLine(x + w - 1, y, h, color);
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, color: number): void {
    x0 = Math.trunc(x0);
    y0 = Math.trunc(y0);
    x1 = Math.trunc(x1);
    y1 = Math.trunc(y1);

    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (steep) {
      [x0, y0] = [y0, x0];
      [x1, y1] = [y1, x1];
    }
    if (x0 > x1) {
      [x0, x1] = [x1, x0];
      [y0, y1] = [y1, y0];
    }

    const dx = x1 - x0;
    const dy = Math.abs(y1 - y0);
    let err = Math.trunc(dx / 2);
    const ystep = y0 < y1 ? 1 : -1;

    for (; x0 <= x1; x0++) {
      if (steep) this.drawPixel(y0, x0, color);
      else this.drawPixel(x0, y0, color);
      err -= dy;
      if (err < 0) {
        y0 += ystep;
        err += dx;
      }
    }
  }

  setCursor(x: number, y: number): void {
    this.cursorX = Math.trunc(x);
    this.cursorY = Math.trunc(y);
  }

  setTextColor(color: number, bg?: number): void {
    this.textColor = color & 0xffff;
    this.textBgColor = bg === undefined ? this.textColor : bg & 0xffff;
  }

  setTextSize(size: number, sy?: number): void {
    this.textSizeX = Math.max(1, Math.trunc(size));
    this.textSizeY = Math.max(1, Math.trunc(sy ?? size));
  }

  setTextWrap(wrap: boolean): void {
    this.wrap = wrap;
  }

  print(value: unknown): void {
    const text = String(value ?? "");
    for (let i = 0; i < text.length; i++) {
      this.write(text.charCodeAt(i) & 0xff);
    }
  }

  write(c: number): void {
    if (c === 10) {
      this.cursorX = 0;
      this.cursorY += this.textSizeY * 8;
      return;
    }
    if (c === 13) return;
    if (this.wrap && this.cursorX + this.textSizeX * 6 > this.width) {
      this.cursorX = 0;
      this.cursorY += this.textSizeY * 8;
    }
    this.drawChar(this.cursorX, this.cursorY, c, this.textColor, this.textBgColor, this.textSizeX, this.textSizeY);
    this.cursorX += this.textSizeX * 6;
  }

  drawChar(
    x: number,
    y: number,
    c: number,
    color: number,
    bg: number,
    sizeX: number,
    sizeY: number = sizeX,
  ): void {
    if (x >= this.width || y >= this.height || x + 6 * sizeX - 1 < 0 || y + 8 * sizeY - 1 < 0) return;
    if (c >= 176) c++;

    for (let i = 0; i < 5; i++) {
      let line = this.font[c * 5 + i] ?? 0;
      for (let j = 0; j < 8; j++, line >>= 1) {
        if (line & 1) {
          if (sizeX === 1 && sizeY === 1) this.writePixel(x + i, y + j, color);
          else this.writeFillRect(x + i * sizeX, y + j * sizeY, sizeX, sizeY, color);
        } else if (bg !== color) {
          if (sizeX === 1 && sizeY === 1) this.writePixel(x + i, y + j, bg);
          else this.writeFillRect(x + i * sizeX, y + j * sizeY, sizeX, sizeY, bg);
        }
      }
    }
    if (bg !== color) {
      if (sizeX === 1 && sizeY === 1) this.writeFastVLine(x + 5, y, 8, bg);
      else this.writeFillRect(x + 5 * sizeX, y, sizeX, 8 * sizeY, bg);
    }
  }

  toRgbaBytes(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.buffer.length * 4);
    for (let i = 0; i < this.buffer.length; i++) {
      const { r, g, b } = rgb565ToRgb888(this.buffer[i]);
      const p = i * 4;
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = 255;
    }
    return out;
  }
}

