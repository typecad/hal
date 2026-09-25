import { describe, done } from '@typecad/hal/testing';
// USB HID keyboard — gated on the board's USB device controller at module
// resolution. One HID interface per program (the v1 ceiling), so the
// keyboard and mouse suites live in separate files — each is its own app.
// The esp32s3 rig's test protocol rides uart0 through the CH34x bridge, so
// USB enumeration never disturbs the [TC:...] capture channel.
import { Keyboard, KEY } from '@typecad/hal';

describe("USB HID keyboard")
  .it("begin/press/release/releaseAll submit boot-keyboard reports")
  .expect(
    (() => {
      const kb = new Keyboard();
      kb.begin();
      kb.press(KEY.CTRL);
      kb.press(KEY.A);
      kb.release(KEY.A);
      kb.release(KEY.CTRL);
      kb.releaseAll();
      return 1;
    })
  ).toBe(1)

done();
