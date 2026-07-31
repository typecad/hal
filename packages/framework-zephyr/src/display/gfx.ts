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
 * Build the display runtime C++ for a profile. The line buffer is one row
 * (width pixels × 2 bytes rgb565); fill_rect/draw_rect/draw_text compute into
 * it row-by-row and display_write each row. No full framebuffer.
 */
export function buildDisplayRuntime(profile: ZephyrDisplayProfile): DisplayRuntimeResult {
  const w = profile.width;
  const stateLines: string[] = [
    '// CUTTLEFISH_DISPLAY_BEGIN',
    `static const struct device* __tc_display = DEVICE_DT_GET(DT_NODELABEL(${profile.dtLabel}));`,
    `static uint16_t __tc_display_line[${w}];  // one-row line buffer (rgb565)`,
    '// CUTTLEFISH_DISPLAY_END',
  ];

  const blInit = profile.backlight
    ? `    const struct device* __bl = DEVICE_DT_GET(DT_ALIAS(${profile.backlight}));\n    gpio_pin_configure(__bl, 0, GPIO_OUTPUT); gpio_pin_set(__bl, 0, 1);`
    : '';

  const helpers = `
static inline void display_init(void) {
    if (!device_is_ready(__tc_display)) { for (;;) { k_msleep(1000); } }
${blInit}
    display_blanking_off(__tc_display);
}

static inline void display_fill_rect(int16_t x, int16_t y, int16_t rw, int16_t h, uint16_t color) {
    for (int16_t row = 0; row < h; row++) {
        for (int16_t i = 0; i < rw; i++) { __tc_display_line[i] = color; }
        display_write(__tc_display, x, y + row, rw, 1, __tc_display_line);
    }
}

static inline void display_draw_rect(int16_t x, int16_t y, int16_t rw, int16_t h, uint16_t color) {
    // Top + bottom edges.
    for (int16_t i = 0; i < rw; i++) { __tc_display_line[i] = color; }
    display_write(__tc_display, x, y, rw, 1, __tc_display_line);
    display_write(__tc_display, x, y + h - 1, rw, 1, __tc_display_line);
    // Left + right edges.
    for (int16_t row = 1; row < h - 1; row++) {
        __tc_display_line[0] = color;
        if (rw > 1) { __tc_display_line[rw - 1] = color; }
        display_write(__tc_display, x, y + row, rw, 1, __tc_display_line);
    }
}

static inline void display_draw_text(int16_t x, int16_t y, const char* text, uint16_t color) {
    int16_t cx = x;
    for (const char* p = text; *p != 0; p++) {
        char ch = *p;
        if (ch >= 'a' && ch <= 'z') { ch = (char)(ch - 32); }  // uppercase only
        if (ch >= 128) { ch = ' '; }                            // unknown → space
        const uint8_t* glyph = __tc_font5x7[(int)ch];
        if (ch != ' ' && (ch < '0' || (ch > '9' && ch < 'A') || ch > 'Z')) { glyph = __tc_font5x7[(int)' ']; }
        for (int col = 0; col < 5; col++) {
            uint8_t bits = glyph[col];
            for (int row = 0; row < 7; row++) {
                __tc_display_line[0] = (bits & (1 << row)) ? color : 0;
                display_write(__tc_display, cx + col, y + row, 1, 1, __tc_display_line);
            }
        }
        cx += 6;  // 5 cols + 1 space
    }
}

static inline void display_flush(void) {
    // No-op: writes are immediate via display_write; there is no framebuffer to push.
}
`;

  const fontTable = fontTableCpp();

  return {
    includes: ['<zephyr/drivers/display.h>'],
    stateLines,
    helpers,
    fontTable,
  };
}
