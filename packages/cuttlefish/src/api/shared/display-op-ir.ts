// ---------------------------------------------------------------------------
// Display HAL Operations — semantic graphics draw calls
//
// Each DisplayHALOp node represents a single display operation. Framework
// strategies (PlatformGraphicsStrategy.resolveDisplayOp) translate these into
// driver-specific C++ (ILI9341 SPI commands, SSD1306 I2C bitpacks, native
// terminal cells). Colors are pre-resolved at transpile time to the target's
// color format, so no runtime color conversion occurs.
// ---------------------------------------------------------------------------

export interface DisplayInitOp {
  operation: "display.init";
  /** Bus identifier, e.g. "SPI" or "Wire" */
  bus: string;
  /** Chip-select pin number */
  cs: number;
  /** Data/Command pin number */
  dc: number;
  /** Reset pin number */
  rst: number;
  /** Panel width in pixels */
  width: number;
  /** Panel height in pixels */
  height: number;
  /** Driver id, e.g. "ili9341" — must be in supportedDisplayDrivers() */
  driver: string;
  /** Optional SPI clock frequency in Hz for SPI-backed displays. */
  spiFrequency?: number;
  /** I2C address (hex) for I2C-backed displays like SSD1309. */
  address?: number;
  /** Reset pin for I2C displays (separate from SPI rst). */
  reset?: number;
}

export interface DisplayFillRectOp {
  operation: "display.fill_rect";
  x: number; y: number; w: number; h: number;
  /** Pre-resolved color value (rgb565 uint16 on color targets, 0/1 on mono) */
  color: number;
}

export interface DisplayDrawTextOp {
  operation: "display.draw_text";
  x: number; y: number;
  text: string;
  /** Font id, e.g. "8x16" — resolved by the driver to a font table */
  fontId: string;
  /** Pre-resolved color value */
  color: number;
}

export interface DisplayDrawRectOp {
  operation: "display.draw_rect";
  x: number; y: number; w: number; h: number;
  color: number;
}

export interface DisplayFlushOp {
  operation: "display.flush";
  /** Dirty rectangles to push to the panel this frame */
  rects: Array<{ x: number; y: number; w: number; h: number }>;
}

export type DisplayHALOp =
  | DisplayInitOp
  | DisplayFillRectOp
  | DisplayDrawTextOp
  | DisplayDrawRectOp
  | DisplayFlushOp;

// Runtime registry of every display operation discriminator. Lets tests verify
// union membership at runtime (type-only `import type` assertions are erased
// and pass vacuously). Keep in sync with DisplayHALOp above.
export const DISPLAY_OPERATION_KINDS = [
  "display.init",
  "display.fill_rect",
  "display.draw_text",
  "display.draw_rect",
  "display.flush",
] as const;

