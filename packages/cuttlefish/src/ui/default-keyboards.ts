// ---------------------------------------------------------------------------
// Built-in default keyboard templates — emitted by the transpiler when an
// <input> has no explicit <keyboard> ref. Both are KeyboardTemplate constants
// (same shape as author-written <keyboard> blocks) so the lowering path is
// uniform: a loader function is generated for each.
// ---------------------------------------------------------------------------

import type { KeyboardTemplate, UIKeyTemplate } from "./html-parser.js";

const k = (ch: string): UIKeyTemplate => ({ ch, special: 0 });

// Alpha: 10×4 grid (bottom dock). Row 2 has shift + backspace; row 3 has
// 123 (page-swap to symbols), space (_), and OK.
export const DEFAULT_ALPHA_KEYBOARD: KeyboardTemplate = {
  id: "default_alpha",
  variant: "alpha",
  rows: [
    [k("1"), k("2"), k("3"), k("4"), k("5"), k("6"), k("7"), k("8"), k("9"), k("0")],
    [k("q"), k("w"), k("e"), k("r"), k("t"), k("y"), k("u"), k("i"), k("o"), k("p")],
    [
      { ch: "⇧", special: 1 },
      k("a"), k("s"), k("d"), k("f"), k("g"), k("h"), k("j"), k("k"), k("l"),
      { ch: "⌫", special: 2 },
    ],
    [
      { ch: "123", special: 4 },
      k("z"), k("x"), k("c"), k("v"), k("b"), k("n"), k("m"),
      k("_"),
      { ch: "OK", special: 3 },
    ],
  ],
};

// Number: 4×4 grid (kept uniform with the alpha column count so the hit-mapping
// math stays simple). Covers digits, ".", "-", ABC (page-swap to alpha),
// backspace, and OK. The last cell duplicates OK — both commit; the grid stays
// rectangular which keeps ui_kb_key_rect() arithmetic uniform.
export const DEFAULT_NUMBER_KEYBOARD: KeyboardTemplate = {
  id: "default_number",
  variant: "number",
  rows: [
    [k("1"), k("2"), k("3"), { ch: "⌫", special: 2 }],
    [k("4"), k("5"), k("6"), k(".")],
    [k("7"), k("8"), k("9"), k("-")],
    [{ ch: "ABC", special: 4 }, k("0"), { ch: "OK", special: 3 }],
  ],
};
