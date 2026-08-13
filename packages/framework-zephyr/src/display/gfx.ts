// ---------------------------------------------------------------------------
// Zephyr display GFX runtime — generic display_write + ported GFX primitives
//
// Emits C++ that resolves a DT-bound display device, keeps a one-row line
// buffer (no full framebuffer — see AGENTS.md rendering guardrails), and
// implements fill_rect / draw_rect / draw_text / flush on top of display_write.
// Text uses a minimal 5x7 bitmap font covering digits 0-9 and uppercase A-Z
// only; unknown characters render as a space.
//
// EMIT BOUNDARY: emitted bytes land in user firmware. Covered by the TypeCAD
// Runtime Exception (RUNTIME_EXCEPTION.md at the repo root).
// ---------------------------------------------------------------------------

import type { ZephyrDisplayProfile } from './profiles.js';

export interface DisplayRuntimeResult {
  /** #include lines to force when the display is used. */
  readonly includes: string[];
  /** File-scope C++ declarations (device handle + line buffer). */
  readonly stateLines: string[];
  /** The C++ helper functions (display_init/fill_rect/draw_rect/draw_text/flush). */
  readonly helpers: string;
  /** The C++ font-table source (exposed for testing). */
  readonly fontTable: string;
}

// 5x7 bitmap glyphs for 0-9 and A-Z. Each glyph is 5 bytes (columns), MSB=top.
// Unknown characters fall back to the space (all-zero columns).
// (Compact hand-authored bitmaps; the test asserts presence of '0'..'9','A'..'Z'.)
function fontTableCpp(): string {
  // A flat map: char -> 5 bytes. Built so the test sees '0'..'9' and 'A'..'Z'.
  const glyphs: Record<string, number[]> = {
    '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
    '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
    '2': [0x42, 0x61, 0x51, 0x49, 0x46],
    '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
    '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
    '5': [0x27, 0x45, 0x45, 0x45, 0x39],
    '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
    '7': [0x01, 0x71, 0x09, 0x05, 0x03],
    '8': [0x36, 0x49, 0x49, 0x49, 0x36],
    '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
    'A': [0x7e, 0x11, 0x11, 0x11, 0x7e],
    'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
    'C': [0x3e, 0x41, 0x41, 0x41, 0x22],
    'D': [0x7f, 0x41, 0x41, 0x22, 0x1c],
    'E': [0x7f, 0x49, 0x49, 0x49, 0x41],
    'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
    'G': [0x3e, 0x41, 0x49, 0x49, 0x7a],
    'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
    'I': [0x00, 0x41, 0x7f, 0x41, 0x00],
    'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
    'K': [0x7f, 0x08, 0x14, 0x22, 0x41],
    'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
    'M': [0x7f, 0x02, 0x0c, 0x02, 0x7f],
    'N': [0x7f, 0x04, 0x08, 0x10, 0x7f],
    'O': [0x3e, 0x41, 0x41, 0x41, 0x3e],
    'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
    'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e],
    'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
    'S': [0x46, 0x49, 0x49, 0x49, 0x31],
    'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
    'U': [0x3f, 0x40, 0x40, 0x40, 0x3f],
    'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
    'W': [0x3f, 0x40, 0x38, 0x40, 0x3f],
    'X': [0x63, 0x14, 0x08, 0x14, 0x63],
    'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
    'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
  };
  const lines: string[] = [
    '// Minimal 5x7 font: digits 0-9 and uppercase A-Z. Unknown chars → space.',
    '// (Rows for other codes are all-zero — the table is indexed by char code.)',
    'static const uint8_t __tc_font5x7[128][5] = {',
  ];
  for (let c = 0; c < 128; c++) {
    const ch = String.fromCharCode(c);
    const known = Object.prototype.hasOwnProperty.call(glyphs, ch);
    const g = glyphs[ch] ?? [0x00, 0x00, 0x00, 0x00, 0x00];
    // Annotate known glyphs (0-9, A-Z) with their char literal; other rows use
    // only the code point so the table carries no stray char literals.
    const label = known ? ` '${ch}'` : ` ${c}`;
    lines.push(`    {0x${g[0].toString(16).padStart(2, '0')}, 0x${g[1].toString(16).padStart(2, '0')}, 0x${g[2].toString(16).padStart(2, '0')}, 0x${g[3].toString(16).padStart(2, '0')}, 0x${g[4].toString(16).padStart(2, '0')}}, //${label}`);
  }
  lines.push('};');
  return lines.join('\n');
}

/**
 * Build the display runtime C++ for a profile.
 *
 * Two rendering models, selected by `profile.colorFormat`:
 *  - `'rgb565'` (TFT): a one-row line buffer (no full framebuffer — see
 *    AGENTS.md rendering guardrails); fill_rect/draw_rect/draw_text stream
 *    each row via display_write.
 *  - `'mono'` (OLED, e.g. SSD1306): a full framebuffer — the standard model
 *    for page-buffered monochrome panels (the AGENTS.md "no full framebuffer"
 *    guardrail targets RGB SPI TFTs, not mono OLEDs). draw ops set bits;
 *    display_flush pushes the whole framebuffer. The MONO01 packing is
 *    horizontal, MSB-first (Zephyr convention): byte = (y*rowBytes)+(x>>3),
 *    bit = 0x80>>(x&7).
 */
export function buildDisplayRuntime(profile: ZephyrDisplayProfile): DisplayRuntimeResult {
  const w = profile.width;
  const h = profile.height;
  const isMono = profile.colorFormat === 'mono';

  // Backlight is optional: the overlay emits the DT alias only when a backlight
  // GPIO is configured. Guard with DT_HAS_ALIAS so this compiles whether or not
  // the alias exists (DT_NODE_HAS_STATUS(DT_ALIAS(...)) is version-dependent
  // when the alias is missing).
  const blInit = profile.backlight
    ? `#if DT_HAS_ALIAS(${profile.backlight})\n    const struct device* __bl = DEVICE_DT_GET(DT_ALIAS(${profile.backlight}));\n    gpio_pin_configure(__bl, 0, GPIO_OUTPUT); gpio_pin_set(__bl, 0, 1);\n#endif`
    : '';

  const stateLines = isMono
    ? [
        '// CUTTLEFISH_DISPLAY_BEGIN',
        `static const struct device* __tc_display = DEVICE_DT_GET(DT_NODELABEL(${profile.dtLabel}));`,
        `// Mono framebuffer (Zephyr MONO01: horizontal, MSB-first). ${(w + 7) >> 3} bytes/row x ${h} rows.`,
        `static uint8_t __tc_display_fb[((${w} * ${h}) + 7) / 8];`,
        '// CUTTLEFISH_DISPLAY_END',
      ]
    : [
        '// CUTTLEFISH_DISPLAY_BEGIN',
        `static const struct device* __tc_display = DEVICE_DT_GET(DT_NODELABEL(${profile.dtLabel}));`,
        `static uint16_t __tc_display_line[${w}];  // one-row line buffer (rgb565)`,
        '// CUTTLEFISH_DISPLAY_END',
      ];

  const helpers = isMono
    ? monoHelpers(w, h, blInit)
    : rgb565Helpers(w, blInit);

  const fontTable = fontTableCpp();

  return {
    includes: ['<zephyr/drivers/display.h>'],
    stateLines,
    helpers,
    fontTable,
  };
}

/**
 * Mono (OLED) helpers: a full framebuffer + bit-packing. SSD1306-class panels
 * are page-buffered, so draw ops set bits in the framebuffer and display_flush
 * pushes the whole buffer. color != 0 ⇒ lit.
 */
function monoHelpers(w: number, h: number, blInit: string): string {
  const rowBytes = (w + 7) >> 3; // bytes per row (w is byte-aligned for 128-wide panels)
  return `
// MONO01 pixel packing: byte = (y * ${rowBytes}) + (x >> 3), bit = 0x80 >> (x & 7).
static inline void __tc_set_pixel(uint16_t x, uint16_t y, uint8_t on) {
    if ((x >= ${w}U) || (y >= ${h}U)) { return; }
    uint16_t idx = static_cast<uint16_t>((static_cast<uint32_t>(y) * ${rowBytes}U) + (x >> 3));
    uint8_t mask = static_cast<uint8_t>(0x80U >> (x & 7U));
    if (on != 0U) {
        __tc_display_fb[idx] = static_cast<uint8_t>(__tc_display_fb[idx] | mask);
    } else {
        __tc_display_fb[idx] = static_cast<uint8_t>(__tc_display_fb[idx] & static_cast<uint8_t>(~mask));
    }
}

static inline void display_init(void) {
    if (!device_is_ready(__tc_display)) { for (;;) { k_msleep(1000); } }
${blInit}
    for (uint16_t i = 0; i < static_cast<uint16_t>(sizeof(__tc_display_fb)); i++) { __tc_display_fb[i] = 0U; }
    display_blanking_off(__tc_display);
}

static inline void display_fill_rect(uint16_t x, uint16_t y, uint16_t rw, uint16_t rh, uint16_t color) {
    uint8_t on = (color != 0U) ? 1U : 0U;
    for (uint16_t row = 0; row < rh; row++) {
        for (uint16_t i = 0; i < rw; i++) {
            __tc_set_pixel(static_cast<uint16_t>(x + i), static_cast<uint16_t>(y + row), on);
        }
    }
}

static inline void display_draw_rect(uint16_t x, uint16_t y, uint16_t rw, uint16_t rh, uint16_t color) {
    uint8_t on = (color != 0U) ? 1U : 0U;
    for (uint16_t i = 0; i < rw; i++) {
        __tc_set_pixel(static_cast<uint16_t>(x + i), y, on);
        __tc_set_pixel(static_cast<uint16_t>(x + i), static_cast<uint16_t>(y + rh - 1U), on);
    }
    for (uint16_t row = 1U; row < rh - 1U; row++) {
        __tc_set_pixel(x, static_cast<uint16_t>(y + row), on);
        __tc_set_pixel(static_cast<uint16_t>(x + rw - 1U), static_cast<uint16_t>(y + row), on);
    }
}

static inline void display_draw_text(uint16_t x, uint16_t y, const char* text, uint16_t color) {
    uint8_t on = (color != 0U) ? 1U : 0U;
    uint16_t cx = x;
    for (const char* p = text; *p != 0; p++) {
        uint8_t uc = static_cast<uint8_t>(*p);
        if (uc >= 128U) { uc = static_cast<uint8_t>(' '); }
        const uint8_t* glyph = &__tc_font5x7[uc][0];
        if (uc >= static_cast<uint8_t>('a') && uc <= static_cast<uint8_t>('z')) {
            glyph = &__tc_font5x7[uc - 32U][0];
        } else if (uc < static_cast<uint8_t>('0')
                   || (uc > static_cast<uint8_t>('9') && uc < static_cast<uint8_t>('A'))
                   || uc > static_cast<uint8_t>('Z')) {
            glyph = &__tc_font5x7[static_cast<uint8_t>(' ')][0];
        }
        for (uint16_t col = 0; col < 5U; col++) {
            uint8_t bits = glyph[col];
            for (uint16_t row = 0; row < 7U; row++) {
                if ((bits & static_cast<uint8_t>(1U << row)) != 0U) {
                    __tc_set_pixel(static_cast<uint16_t>(cx + col), static_cast<uint16_t>(y + row), on);
                }
            }
        }
        cx = static_cast<uint16_t>(cx + 6U);
    }
}

static inline void display_flush(void) {
    struct display_buffer_descriptor __desc;
    __desc.buf_size = sizeof(__tc_display_fb);   // ${rowBytes} * ${h} bytes
    __desc.width = ${w}U;
    __desc.height = ${h}U;
    __desc.pitch = ${rowBytes}U;                  // bytes per row
    __desc.frame_incomplete = false;
    (void)display_write(__tc_display, 0, 0, &__desc, __tc_display_fb);
}
`;
}

/**
 * RGB565 (TFT) helpers: a one-row line buffer; each op streams rows via
 * display_write. No full framebuffer (AGENTS.md rendering guardrails).
 */
function rgb565Helpers(w: number, blInit: string): string {
  return `
// Write a single row of \`rw\` rgb565 pixels at (x,y). Builds the
// display_buffer_descriptor the Zephyr display_write API requires (rgb565 =
// 2 bytes/pixel) and pushes the one-row line buffer.
static inline void __tc_display_write_row(uint16_t x, uint16_t y, uint16_t rw) {
    struct display_buffer_descriptor __desc;
    __desc.buf_size = static_cast<uint32_t>(rw) * 2U;   // 2 bytes per rgb565 pixel
    __desc.width = rw;
    __desc.height = 1U;
    __desc.pitch = rw;
    __desc.frame_incomplete = false;
    (void)display_write(__tc_display, x, y, &__desc, __tc_display_line);
}

static inline void display_init(void) {
    if (!device_is_ready(__tc_display)) { for (;;) { k_msleep(1000); } }
${blInit}
    display_blanking_off(__tc_display);
}

static inline void display_fill_rect(uint16_t x, uint16_t y, uint16_t rw, uint16_t h, uint16_t color) {
    for (uint16_t row = 0; row < h; row++) {
        for (uint16_t i = 0; i < rw; i++) { __tc_display_line[i] = color; }
        __tc_display_write_row(x, static_cast<uint16_t>(y + row), rw);
    }
}

static inline void display_draw_rect(uint16_t x, uint16_t y, uint16_t rw, uint16_t h, uint16_t color) {
    // Top + bottom edges.
    for (uint16_t i = 0; i < rw; i++) { __tc_display_line[i] = color; }
    __tc_display_write_row(x, y, rw);
    __tc_display_write_row(x, static_cast<uint16_t>(y + h - 1U), rw);
    // Left + right edges.
    for (uint16_t row = 1U; row < h - 1U; row++) {
        __tc_display_line[0] = color;
        if (rw > 1U) { __tc_display_line[rw - 1U] = color; }
        __tc_display_write_row(x, static_cast<uint16_t>(y + row), rw);
    }
}

static inline void display_draw_text(uint16_t x, uint16_t y, const char* text, uint16_t color) {
    uint16_t cx = x;
    for (const char* p = text; *p != 0; p++) {
        // Read the byte UNSIGNED so bytes >= 0x80 don't index the 128-entry
        // font table negatively (signed char would make 0x80 == -128).
        uint8_t uc = static_cast<uint8_t>(*p);
        if (uc >= 128U) { uc = static_cast<uint8_t>(' '); }     // unknown → space
        const uint8_t* glyph = &__tc_font5x7[uc][0];
        // Lowercase → uppercase; anything outside 0-9/A-Z → space glyph.
        if (uc >= static_cast<uint8_t>('a') && uc <= static_cast<uint8_t>('z')) {
            glyph = &__tc_font5x7[uc - 32U][0];
        } else if (uc < static_cast<uint8_t>('0')
                   || (uc > static_cast<uint8_t>('9') && uc < static_cast<uint8_t>('A'))
                   || uc > static_cast<uint8_t>('Z')) {
            glyph = &__tc_font5x7[static_cast<uint8_t>(' ')][0];
        }
        for (uint16_t col = 0; col < 5U; col++) {
            uint8_t bits = glyph[col];
            for (uint16_t row = 0; row < 7U; row++) {
                __tc_display_line[0] = ((bits & static_cast<uint8_t>(1U << row)) != 0U) ? color : 0U;
                __tc_display_write_row(static_cast<uint16_t>(cx + col), static_cast<uint16_t>(y + row), 1U);
            }
        }
        cx = static_cast<uint16_t>(cx + 6U);  // 5 cols + 1 space
    }
}

static inline void display_flush(void) {
    // No-op: writes are immediate via display_write; there is no framebuffer to push.
}
`;
}
