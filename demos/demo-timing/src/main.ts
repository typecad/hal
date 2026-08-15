// demo-timing — exercises the new Timing paradigm.
//
// Shows the sync/async dual-mode `wait` (same symbol, blocking vs yielding
// chosen by `await`), the `Duration` typed-time factory, the `every` cadence
// with a `Cancellable` handle, and `Clock` for deadline-style timeouts.

import { Timing, Duration, Clock, OutputPin, LED_BUILTIN } from '@typecad/hal';

const led = new OutputPin(LED_BUILTIN);

// ── 1. SYNC wait: blocks the CPU (lowers to delay()) ──────────────────────
// Duration.hz(2) folds to 500 (period of a 2 Hz signal) at compile time.
function syncBlink(): void {
  led.high();
  Timing.wait(Duration.hz(2));   // → delay(500)
  led.low();
  Timing.wait(Duration.hz(2));   // → delay(500)
}

// ── 2. ASYNC wait: yields to other tasks (lowers to a state machine) ──────
// The SAME Timing.wait symbol, now awaited → the transpiler splits this into a
// cooperative task that runs alongside others.
async function asyncBlink() {
  while (true) {
    led.toggle();
    await Timing.wait(Duration.seconds(1));   // → 1000 ms deadline in a state
  }
}

// ── 3. CADENCE: every() returns a Cancellable handle ──────────────────────
Timing.every(Duration.minutes(1), (): void => {
  led.toggle();
});

// Entry point
syncBlink();
asyncBlink();
