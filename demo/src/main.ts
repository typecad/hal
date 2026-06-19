// ---------------------------------------------------------------------------
// main.ts — Debounced button cycling a mode counter
//                                  (cuttlefish demo #35, Arduino AVR target).
//
// The classic embedded input pattern: read a momentary pushbutton, debounce
// it in software with a time gate, detect the press EDGE (one event per
// physical press, not per polling loop), and advance a state machine. Each
// press cycles a mode counter; the on-board LED reflects the low bit and the
// current mode is printed to Serial.
//
// This is the first demo to exercise DIGITAL INPUT + a TIMING-BASED debounce
// state machine. Where demo #34 read an analog value and demo #33 did pure
// computation, this one reads a digital pin with `inputPullUp` (so an unpressed
// button reads HIGH via the internal pull-up, and a press pulls it LOW),
// stores that reading in a variable across loop iterations, and uses
// `Timing.millis()` as a monotonic clock for the debounce interval.
//
// AVR + the HAL lowering shape the program:
//
//   • The button (D2) and LED (D13) come from `@typecad/board-arduino-uno`.
//     `D2.inputPullUp()` lowers to `pinMode(2, INPUT_PULLUP)` and returns an
//     InputPin alias; `LED.asOutput()` lowers to `pinMode(13, OUTPUT)`.
//   • `btn.read()` is a value-bearing HAL op (gpioRead → `digitalRead(2)`).
//     Its return IS stored in a variable and reused — this works correctly
//     because of demo #34 Finding B's fix (a value-bearing halOp read is
//     captured into a real `auto v = digitalRead(2)`, not substituted with the
//     pin number). So this demo directly re-tests that fix for the digital
//     path.
//   • `Timing.millis()` lowers to `millis()` (a monotonic millisecond clock).
//     Debounce compares the current reading against the last-seen state and
//     only accepts a change after DEBOUNCE_MS of stability — the standard
//     edge-detect-with-hysteresis pattern that kills contact bounce.
//   • Owned state (the debounced button level, the last edge time, the mode
//     counter, the print-suppression flag) lives in MODULE-LEVEL scalars, not
//     a `new`'d class — AVR has no heap manager, so `new` is rejected by the
//     `heap-allocation-avr` gate (demo #34 Finding A). This is the
//     AVR-correct shape for a handful of owned scalars.
//
// Hardware: wire a momentary pushbutton between D2 and GND. With the internal
// pull-up enabled, the pin reads HIGH when open and LOW when pressed. No
// external resistor needed. The on-board LED (D13) toggles with the mode's low
// bit so you can see state changes without the serial monitor.
//
// Idiomatic constraints honored (per SUPPORT_MATRIX / eslint rules): only
// `const enum`; no `any`; no typed-array fields/returns; no object spread; no
// `instanceof`; no `String.*`/`Number.*` statics; and (AVR-specific) no
// dynamically-grown array fields/params/returns and no heap `new`.
// ---------------------------------------------------------------------------

import { LED, D2 } from '@typecad/board-arduino-uno';

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

// Debounce interval: a reading must be stable for this long before it is
// accepted as a real edge. 20 ms is a typical mechanical-switch debounce
// window — short enough to feel responsive, long enough to reject bounce.
const DEBOUNCE_MS: int32_t = 20;

// Number of modes the counter cycles through. Kept small so the serial output
// is readable and the LED (low bit) visibly toggles.
const MODE_COUNT: int32_t = 4;

// ---------------------------------------------------------------------------
// Owned state (module-level scalars — AVR-correct, no `new`, no heap).
// ---------------------------------------------------------------------------

// The last ACCEPTED (debounced) button level. With the pull-up, true = open
// (HIGH), false = pressed (LOW). Seeded `true` so the first poll doesn't read
// as a spurious press.
let buttonLevel: boolean = true;

// Timestamp (ms) of the last RAW level change. A new level is only accepted
// once `Timing.millis() - lastChangeMs >= DEBOUNCE_MS`.
let lastChangeMs: int32_t = 0;

// The current mode counter. Each accepted press edge advances it
// (modulo MODE_COUNT).
let mode: int32_t = 0;

// The debounced level as of the PREVIOUS poll, used to detect the press EDGE
// (HIGH→LOW transition). Seeded `true` (open) so the first poll after boot
// doesn't read as a press.
let prevLevel: boolean = true;

// ---------------------------------------------------------------------------
// Read the raw button level and debounce it. Returns the newly-accepted
// debounced level, or the previous level if the raw reading hasn't been stable
// long enough. Standard edge-detect-with-hysteresis.
//
// `btn.read()` is a value-bearing HAL op; its return is stored in `raw` and
// reused (works correctly per demo #34 Finding B's fix).
// ---------------------------------------------------------------------------

function debounce(): boolean {
  const raw: boolean = btn.read();
  if (raw !== buttonLevel) {
    // Raw level differs from the accepted one — wait out the debounce window.
    const now: int32_t = Timing.millis();
    if (now - lastChangeMs >= DEBOUNCE_MS) {
      buttonLevel = raw;
      lastChangeMs = now;
    }
  } else {
    // Raw matches accepted — this reading is the stable baseline; keep the
    // debounce clock aligned to it so the NEXT change starts a fresh window.
    lastChangeMs = Timing.millis();
  }
  return buttonLevel;
}

// ---------------------------------------------------------------------------
// Format a one-line mode report. Built by string concatenation. The ternary
// of two string literals is fine inline (demo #34 Finding D fix).
// ---------------------------------------------------------------------------

function report(mode: int32_t): string {
  let line: string = '';
  line = line + 'mode=' + mode;
  line = line + ' led=' + (mode % 2 === 1 ? 'on ' : 'off');
  return line;
}

// ---------------------------------------------------------------------------
// Configure the pins once. These top-level calls run in the auto-generated
// `setup()` and lower to `pinMode(13, OUTPUT)` / `pinMode(2, INPUT_PULLUP)`.
// `btn`/`led` are top-level aliases referenced by the helpers; HAL resolution
// is order-independent (demo #34 Finding C fix).
// ---------------------------------------------------------------------------

const led = LED.asOutput();
const btn = D2.inputPullUp();

// ---------------------------------------------------------------------------
// Periodic work. Poll the debounced button; on each accepted PRESS edge
// (HIGH→LOW) advance the mode and drive the LED to the mode's low bit. Print
// the new mode once per press. The `while (true)` loop keeps the auto-
// generated `loop()` empty; a small `Timing.delay` bounds CPU use.
// ---------------------------------------------------------------------------

console.log('--- debounced button demo ---');
console.log(report(mode));
led.low();

while (true) {
  const level: boolean = debounce();

  // A PRESS is the HIGH→LOW edge (pull-up: pressed reads LOW): the debounced
  // level just went LOW while the previous poll saw it HIGH. Detect the edge
  // once, advance the mode, drive the LED to the mode's low bit, and announce.
  if (!level && prevLevel) {
    mode = (mode + 1) % MODE_COUNT;
    if (mode % 2 === 1) {
      led.high();
    } else {
      led.low();
    }
    console.log(report(mode));
  }
  prevLevel = level;

  Timing.delay(5);
}
