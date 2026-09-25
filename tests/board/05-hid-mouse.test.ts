import { describe, done } from '@typecad/hal/testing';
// USB HID mouse — one HID interface per program (see 05-hid-keyboard).
import { Mouse, MOUSE } from '@typecad/hal';

describe("USB HID mouse")
  .it("begin/move/click submit clamped relative reports")
  .expect(
    (() => {
      const m = new Mouse();
      m.begin();
      m.move(10, -4);
      m.move(500, 500); // clamps to int8 — never a malformed report
      m.click(MOUSE.LEFT);
      m.press(MOUSE.RIGHT);
      m.release(MOUSE.RIGHT);
      return 1;
    })
  ).toBe(1)

done();
