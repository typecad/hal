import { describe, done } from '@typecad/expect';

// On-device timer tests: setInterval/setTimeout backed by the Timer0 millis
// ISR + the cooperative __tc_TimerRuntime pumped from loop().
//
// IMPORTANT: __tc_TimerRuntime.run() is called from loop(), and Timing.delay()
// is a BLOCKING call (_delay_ms) that does NOT pump the timer runtime. So
// callbacks only fire between loop() iterations. These tests account for that
// by using millis()-based waits inside a manual polling loop rather than
// Timing.delay(), so the timer pump runs on each iteration.
//
// Callback state must be file-scope: setInterval callbacks are extracted to
// top-level free functions and cannot capture test-local variables.

let _tick_count = 0;
let _timeout_fired = 0;

function onTick() { _tick_count++; }
function onTimeout() { _timeout_fired++; }

// Wait 'ms' milliseconds while pumping the timer runtime each iteration.
// Unlike Timing.delay(), this lets pending setInterval/setTimeout callbacks
// fire between checks.
function _waitAndPump(ms: number): void {
  const t0 = Timing.millis();
  while (Timing.millis() - t0 < ms) {
    __tc_timer_runtime.run();
  }
}

describe("Native AVR timers (setInterval/setTimeout)")
  .it("setTimeout fires exactly once then self-cancels")
  .expect(
    (() => {
      _timeout_fired = 0;
      setTimeout(onTimeout, 50);
      _waitAndPump(150);
      return _timeout_fired;
    })
  ).toBe(1)
  .it("setInterval fires multiple times over a 250ms window")
  .expect(
    (() => {
      _tick_count = 0;
      setInterval(onTick, 50);
      _waitAndPump(250);
      return _tick_count >= 3 ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.millis() advances and returns increasing values")
  .expect(
    (() => {
      const t0 = Timing.millis();
      Timing.delay(10);
      const t1 = Timing.millis();
      return t1 > t0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.millis() is roughly accurate (50ms delay measured)")
  .expect(
    (() => {
      const t0 = Timing.millis();
      Timing.delay(50);
      const elapsed = Timing.millis() - t0;
      return (elapsed >= 40 && elapsed <= 120) ? 1 : 0;
    })
  ).toBe(1)

done();
