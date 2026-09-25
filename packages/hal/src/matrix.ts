// ---------------------------------------------------------------------------
// Matrix — GPIO key-matrix scanning over the Zephyr input subsystem
//
// The gpio-kbd-matrix driver scans the row/column grid and reports each key
// event as ABS_X (column) + ABS_Y (row) + BTN_TOUCH (press state); the
// lowered shim decodes that triple and trampolines into the user callback
// as (row, col, pressed). Rows are inputs (pull-up, active-low); columns
// are driven one at a time. Idle mode is interrupt-on-row (the binding
// default) — no CPU while idle.
// ----------------------------------------------------------------------------

import { matrixOnKey } from './emit.js';
import { callback } from './callback.js';
import type { Pin } from './gpio.js';

/**
 * A scanned key matrix: `const kbd = new Matrix({ rows: [PA0, PA1], cols:
 * [PB6, PB7, PB8] }); kbd.onKey((row: number, col: number, pressed:
 * boolean) => { ... });`. Row and column pads come from the board module's
 * pin exports. The handler fires from the scan thread — keep it short (set
 * a flag, post to the UI), the Arduino-ISR discipline.
 */
export class Matrix {
  private readonly _rows: number[];
  private readonly _cols: number[];

  /** Construct a matrix from its row and column pads. */
  constructor(opts: { rows: Pin[]; cols: Pin[] }) {
    this._rows = opts.rows.map((p) => p.number);
    this._cols = opts.cols.map((p) => p.number);
  }

  /** Register the key handler: `(row, col, pressed)` — annotate the
   *  callback's parameters (`(row: number, col: number, pressed: boolean)`)
   *  so the lowering types the trampoline. */
  onKey(handler: (row: number, col: number, pressed: boolean) => void): void {
    matrixOnKey(this._rows, this._cols, callback(handler));
  }
}
