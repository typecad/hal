import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles gpioOut, gpioIn, pwm
// GPIO key-matrix scanning — pure GPIO composition, no extra wiring: with
// no physical matrix attached the pull-up rows simply read idle, and the
// suite proves the gpio-kbd-matrix node builds, the scan thread starts,
// and the handler registration runs without trapping.
import { GPIO4, GPIO5, GPIO6, GPIO7, Matrix } from '@typecad/hal';

describe("Matrix scanning")
  .it("Matrix({ rows, cols }) constructs and the handler registers")
  .expect(
    (() => {
      const kbd = new Matrix({ rows: [GPIO4, GPIO5], cols: [GPIO6, GPIO7] });
      kbd.onKey((row: number, col: number, pressed: boolean): void => {
        if (pressed && row >= 0 && col >= 0) {
          const _seen = 1;
        }
      });
      return 1;
    })
  ).toBe(1)

done();
