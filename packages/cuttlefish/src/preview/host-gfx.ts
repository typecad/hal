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

export function blendRgb565(fg: number, bg: number, opacity: number): number {
  if (opacity >= 100) return fg & 0xffff;
  if (opacity <= 0) return bg & 0xffff;
  const fr = (fg >> 11) & 0x1f;
  const fg6 = (fg >> 5) & 0x3f;
  const fb = fg & 0x1f;
  const br = (bg >> 11) & 0x1f;
  const bg6 = (bg >> 5) & 0x3f;
  const bb = bg & 0x1f;
  const r = Math.trunc((fr * opacity + br * (100 - opacity)) / 100);
  const g = Math.trunc((fg6 * opacity + bg6 * (100 - opacity)) / 100);
  const b = Math.trunc((fb * opacity + bb * (100 - opacity)) / 100);
  return ((r & 0x1f) << 11) | ((g & 0x3f) << 5) | (b & 0x1f);
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
  private clipRect: { x: number; y: number; w: number; h: number } | undefined;

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

  setClipRect(rect: { x: number; y: number; w: number; h: number } | undefined): void {
    this.clipRect = rect ? {
      x: Math.trunc(rect.x),
      y: Math.trunc(rect.y),
      w: Math.max(0, Math.trunc(rect.w)),
      h: Math.max(0, Math.trunc(rect.h)),
    } : undefined;
  }

  getClipRect(): { x: number; y: number; w: number; h: number } | undefined {
    return this.clipRect ? { ...this.clipRect } : undefined;
  }

  withClipRect<T>(rect: { x: number; y: number; w: number; h: number } | undefined, fn: () => T): T {
    const previous = this.clipRect;
    this.setClipRect(rect);
    try {
      return fn();
    } finally {
      this.clipRect = previous;
    }
  }

  private insideClip(x: number, y: number): boolean {
    const clip = this.clipRect;
    return !clip || (x >= clip.x && y >= clip.y && x < clip.x + clip.w && y < clip.y + clip.h);
  }

  drawPixel(x: number, y: number, color: number): void {
    x = Math.trunc(x);
    y = Math.trunc(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    if (!this.insideClip(x, y)) return;
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
    if (this.clipRect) {
      x0 = Math.max(x0, this.clipRect.x);
      y0 = Math.max(y0, this.clipRect.y);
      x1 = Math.min(x1, this.clipRect.x + this.clipRect.w);
      y1 = Math.min(y1, this.clipRect.y + this.clipRect.h);
    }
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

  drawRoundRect(x: number, y: number, w: number, h: number, r: number, color: number): void {
    x = Math.trunc(x);
    y = Math.trunc(y);
    w = Math.trunc(w);
    h = Math.trunc(h);
    r = Math.max(0, Math.trunc(r));
    if (w <= 0 || h <= 0) return;
    if (r <= 0) {
      this.drawRect(x, y, w, h, color);
      return;
    }
    r = Math.min(r, Math.trunc(Math.min(w, h) / 2));
    this.drawFastHLine(x + r, y, w - 2 * r, color);
    this.drawFastHLine(x + r, y + h - 1, w - 2 * r, color);
    this.drawFastVLine(x, y + r, h - 2 * r, color);
    this.drawFastVLine(x + w - 1, y + r, h - 2 * r, color);
    this.drawCircleHelper(x + r, y + r, r, 1, color);
    this.drawCircleHelper(x + w - r - 1, y + r, r, 2, color);
    this.drawCircleHelper(x + w - r - 1, y + h - r - 1, r, 4, color);
    this.drawCircleHelper(x + r, y + h - r - 1, r, 8, color);
  }

  fillRoundRect(x: number, y: number, w: number, h: number, r: number, color: number): void {
    x = Math.trunc(x);
    y = Math.trunc(y);
    w = Math.trunc(w);
    h = Math.trunc(h);
    r = Math.max(0, Math.trunc(r));
    if (w <= 0 || h <= 0) return;
    if (r <= 0) {
      this.fillRect(x, y, w, h, color);
      return;
    }
    r = Math.min(r, Math.trunc(Math.min(w, h) / 2));
    this.fillRect(x + r, y, w - 2 * r, h, color);
    const delta = Math.max(0, h - 2 * r - 1);
    this.fillCircleHelper(x + w - r - 1, y + r, r, 1, delta, color);
    this.fillCircleHelper(x + r, y + r, r, 2, delta, color);
  }

  drawCircle(x0: number, y0: number, r: number, color: number): void {
    x0 = Math.trunc(x0);
    y0 = Math.trunc(y0);
    r = Math.trunc(r);
    let f = 1 - r;
    let ddFx = 1;
    let ddFy = -2 * r;
    let x = 0;
    let y = r;

    this.drawPixel(x0, y0 + r, color);
    this.drawPixel(x0, y0 - r, color);
    this.drawPixel(x0 + r, y0, color);
    this.drawPixel(x0 - r, y0, color);

    while (x < y) {
      if (f >= 0) {
        y--;
        ddFy += 2;
        f += ddFy;
      }
      x++;
      ddFx += 2;
      f += ddFx;

      this.drawPixel(x0 + x, y0 + y, color);
      this.drawPixel(x0 - x, y0 + y, color);
      this.drawPixel(x0 + x, y0 - y, color);
      this.drawPixel(x0 - x, y0 - y, color);
      this.drawPixel(x0 + y, y0 + x, color);
      this.drawPixel(x0 - y, y0 + x, color);
      this.drawPixel(x0 + y, y0 - x, color);
      this.drawPixel(x0 - y, y0 - x, color);
    }
  }

  private drawCircleHelper(x0: number, y0: number, r: number, cornername: number, color: number): void {
    x0 = Math.trunc(x0);
    y0 = Math.trunc(y0);
    r = Math.trunc(r);
    let f = 1 - r;
    let ddFx = 1;
    let ddFy = -2 * r;
    let x = 0;
    let y = r;

    while (x < y) {
      if (f >= 0) {
        y--;
        ddFy += 2;
        f += ddFy;
      }
      x++;
      ddFx += 2;
      f += ddFx;

      if (cornername & 0x4) {
        this.drawPixel(x0 + x, y0 + y, color);
        this.drawPixel(x0 + y, y0 + x, color);
      }
      if (cornername & 0x2) {
        this.drawPixel(x0 + x, y0 - y, color);
        this.drawPixel(x0 + y, y0 - x, color);
      }
      if (cornername & 0x8) {
        this.drawPixel(x0 - y, y0 + x, color);
        this.drawPixel(x0 - x, y0 + y, color);
      }
      if (cornername & 0x1) {
        this.drawPixel(x0 - y, y0 - x, color);
        this.drawPixel(x0 - x, y0 - y, color);
      }
    }
  }

  fillCircle(x0: number, y0: number, r: number, color: number): void {
    x0 = Math.trunc(x0);
    y0 = Math.trunc(y0);
    r = Math.trunc(r);
    this.drawFastVLine(x0, y0 - r, 2 * r + 1, color);
    this.fillCircleHelper(x0, y0, r, 3, 0, color);
  }

  private fillCircleHelper(x0: number, y0: number, r: number, corners: number, delta: number, color: number): void {
    let f = 1 - r;
    let ddFx = 1;
    let ddFy = -2 * r;
    let x = 0;
    let y = r;
    let px = x;
    let py = y;

    delta++;
    while (x < y) {
      if (f >= 0) {
        y--;
        ddFy += 2;
        f += ddFy;
      }
      x++;
      ddFx += 2;
      f += ddFx;
      if (x < y + 1) {
        if (corners & 1) this.drawFastVLine(x0 + x, y0 - y, 2 * y + delta, color);
        if (corners & 2) this.drawFastVLine(x0 - x, y0 - y, 2 * y + delta, color);
      }
      if (y !== py) {
        if (corners & 1) this.drawFastVLine(x0 + py, y0 - px, 2 * px + delta, color);
        if (corners & 2) this.drawFastVLine(x0 - py, y0 - px, 2 * px + delta, color);
        py = y;
      }
      px = x;
    }
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

  textWidth(value: unknown, size = this.textSizeX): number {
    return String(value ?? "").length * Math.max(1, Math.trunc(size)) * 6;
  }

  textHeight(size = this.textSizeY): number {
    return Math.max(1, Math.trunc(size)) * 8;
  }

  drawAntialiasedText(value: unknown, x: number, y: number, color: number, bg: number, size: number): void {
    const text = String(value ?? "");
    if (!text) return;
    size = Math.max(1, Math.trunc(size));
    const w = this.textWidth(text, size);
    const h = this.textHeight(size);
    if (w <= 0 || h <= 0 || (color & 0xffff) === (bg & 0xffff)) {
      this.setCursor(x, y);
      this.setTextColor(color, bg);
      this.setTextSize(size);
      this.setTextWrap(false);
      this.print(text);
      return;
    }
    const destX = Math.trunc(x);
    const destY = Math.trunc(y);
    const activeClip = this.clipRect ?? { x: 0, y: 0, w: this.width, h: this.height };
    const clipX0 = Math.max(destX, activeClip.x, 0);
    const clipY0 = Math.max(destY, activeClip.y, 0);
    const clipX1 = Math.min(destX + w, activeClip.x + activeClip.w, this.width);
    const clipY1 = Math.min(destY + h, activeClip.y + activeClip.h, this.height);
    if (clipX0 >= clipX1 || clipY0 >= clipY1) return;
    const localX0 = clipX0 - destX;
    const localY0 = clipY0 - destY;
    const localX1 = clipX1 - destX;
    const localY1 = clipY1 - destY;

    const src = new HostAdafruitGFX(w, h, this.font);
    src.fillScreen(bg);
    src.setCursor(0, 0);
    src.setTextColor(color, bg);
    src.setTextSize(size);
    src.setTextWrap(false);
    src.print(text);

    const fg = color & 0xffff;
    const background = bg & 0xffff;
    const out = new Uint16Array(w * h);
    out.fill(background);
    const foregroundNeighbors = (px: number, py: number, radius = 1): number => {
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = py + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = px + dx;
          if (xx < 0 || xx >= w) continue;
          if (src.buffer[yy * w + xx] === fg) count++;
        }
      }
      return count;
    };
    const coverageFor = (neighbors: number, outerNeighbors: number, isFg: boolean): number => {
      if (isFg) {
        if (size <= 1) return neighbors >= 4 ? 100 : 96;
        if (size === 2) return neighbors >= 8 ? 100 : neighbors >= 5 ? 96 : 92;
        return neighbors >= 8 ? 100 : neighbors >= 6 ? 96 : neighbors >= 4 ? 90 : 84;
      }
      if (neighbors === 0) {
        return size >= 3 && outerNeighbors > 0 ? Math.min(14, outerNeighbors * 2) : 0;
      }
      const step = size <= 1 ? 4 : size === 2 ? 6 : 8;
      const cap = size <= 1 ? 18 : size === 2 ? 28 : 38;
      return Math.min(cap, neighbors * step);
    };

    for (let yy = localY0; yy < localY1; yy++) {
      for (let xx = localX0; xx < localX1; xx++) {
        const px = src.buffer[yy * w + xx];
        const neighbors = foregroundNeighbors(xx, yy);
        const outerNeighbors = size >= 3 && px !== fg && neighbors === 0 ? foregroundNeighbors(xx, yy, 2) : 0;
        const coverage = coverageFor(neighbors, outerNeighbors, px === fg);
        out[yy * w + xx] = coverage === 0 ? background : blendRgb565(fg, background, coverage);
      }
    }

    for (let yy = localY0; yy < localY1; yy++) {
      for (let xx = localX0; xx < localX1; xx++) {
        this.drawPixel(destX + xx, destY + yy, out[yy * w + xx]);
      }
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
