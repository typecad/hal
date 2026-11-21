import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles matrixRows, matrixCols
// GPIO key-matrix scanning — pure GPIO composition, no extra wiring: with
// no physical matrix attached the pull-up rows simply read idle, and the
// suite proves the gpio-kbd-matrix node builds, the scan thread starts,
// and the handler registration runs without trapping. The pads are ARRAY
// test-pins roles (MATRIX_ROWS/MATRIX_COLS — the preprocessor substitutes
// the board's array literals), so the file runs unchanged on every board:
// importing one family's board-module pin names here built only on that
// family and failed the OTHER board's suite at transpile.
import { MATRIX_ROWS, MATRIX_COLS } from '@typecad/test-pins';
import { Matrix } from '@typecad/hal';

describe("Matrix scanning")
  .it("Matrix({ rows, cols }) constructs and the handler registers")
  .expect(
    (() => {
      const kbd = new Matrix({ rows: MATRIX_ROWS, cols: MATRIX_COLS });
      kbd.onKey((row: number, col: number, pressed: boolean): void => {
        if (pressed && row >= 0 && col >= 0) {
          const _seen = 1;
        }
      });
      return 1;
    })
  ).toBe(1)

done();
