// Random typist — a USB keyboard that taps a random key every 5–15 seconds.
//
// Plug the DevKitC's USB port into a host and open any text field: the
// board types one key at irregular intervals.
//
// Two v1 realities shape the key PICK (documented in hal/hid.ts):
//  - KEY.* tokens are compile-time — they map to Zephyr's HID_KEY_* macros
//    only in call positions, so a runtime pick cannot index a KEY.* array.
//    The pick instead computes the HID usage CODE arithmetically: letters
//    a-z are 4..29 and digits 0-9 are 30..39 — contiguous by design.
//  - Time.sleep lowers with a compile-time constant; the variable delay is
//    a runtime loop of fixed 100 ms sleeps.

import { Keyboard, Random, Time } from '@typecad/hal';

const kb = new Keyboard();
kb.begin();

while (true) {
  // 5–15 s as 50–150 deciseconds (between() is [min, max)).
  const deciseconds = Random.between(50, 150);
  for (let waited = 0; waited < deciseconds; waited = waited + 1) {
    Time.sleep(100);
  }

  // 0..25 → a-z (usage 4..29), 26..35 → 0-9 (usage 30..39),
  // 36 → space (44), 37 → enter (40).
  const pick = Random.upTo(38);
  let code = 4 + pick;
  if (pick >= 26 && pick < 36) {
    code = 30 + (pick - 26);
  } else if (pick === 36) {
    code = 44; // space
  } else if (pick === 37) {
    code = 40; // enter
  }

  kb.press(code);
  // A key needs to be HELD for at least one IN-poll interval for the host
  // to see it — a back-to-back press/release pair can be overwritten in the
  // endpoint before the host polls. 30 ms reads as a fast human tap.
  Time.sleep(30);
  kb.release(code);
}
