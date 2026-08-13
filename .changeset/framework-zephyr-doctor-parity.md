---
"@typecad/framework-zephyr": minor
---

## Zephyr doctor parity with framework-arduino

Brings `cuttlefish doctor` (Zephyr) to feature parity with the Arduino
framework's doctor, which checks the build tool is installed and the board
support is present. The Zephyr doctor now performs the same two checks through
a new shared, structured `checkZephyrEnv()`:

- **west toolchain probe** — verifies `west` (the Zephyr build tool) is
  discoverable + responsive (the direct analog of `arduino-cli` presence) and
  reports the discovered version + source. Previously the doctor only read the
  Zephyr RTOS `VERSION` file and never confirmed the actual build tool worked.
- **board-support check** — verifies the configured board target exists in the
  Zephyr checkout (`$ZEPHYR_BASE/boards/`), the analog of the Arduino
  `arduino-cli core list` check, and prints a `west boards` hint when it is
  missing. Previously the doctor only previewed how the target string
  normalizes.
- **`checkZephyrEnv()`** — a structured result (`{ ok, reason, messages,
  fixCommand, check }`) mirroring `@typecad/arduino-cli`'s `checkArduinoEnv`,
  with failure precedence `west-not-found` → `zephyr-out-of-range` →
  `board-not-supported`. `doctor.ts` is now a thin presenter over it so the
  detection logic can be reused by the build/test gates. The existing
  compat-range check and board-target normalization preview are preserved.
