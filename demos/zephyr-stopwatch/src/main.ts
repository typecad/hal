// ---------------------------------------------------------------------------
// main.ts — stopwatch (Black Pill + console UART + pot + button)
//
// The pot acts as a throttle dial: below 800 mV it arms the watch, a button
// press starts a session. Running sessions accumulate laps (nested records:
// a Session holds a Lap[]); a second press closes the session into the
// history and prints a per-session report. The state machine is a switch
// over a numeric enum; lap pacing reads the previous lap with string
// relational formatting in the report line.
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON, PA1,
  ADC, UART0,
  Time, Trace,
} from '@typecad/hal';

// ── Tunables ───────────────────────────────────────────────────────────────
const ARM_MV = 800;
const LAP_MIN_MS = 1200;
const MAX_SESSIONS = 6;

enum RunState { Idle, Armed, Running }

type Lap = {
  index: number;
  ms: number;
};

type Session = {
  startedAt: number;
  closedAt: number;
  laps: Lap[];
};

/** Format a duration as `12.3s`. */
function secs(ms: number): string {
  return (ms / 1000.0).toFixed(1);
}

/** Lap pacing label: negative delta means faster than the previous lap. */
function pace(lap: Lap, prev: Lap | null): string {
  if (prev === null) {
    return 'first';
  }
  const d = lap.ms - prev.ms;
  if (d < 0) {
    return `-${secs(-d)}`;
  }
  if (d > 0) {
    return `+${secs(d)}`;
  }
  return 'even';
}

/** Total and slowest lap of a session. */
function summarize(s: Session): { totalMs: number; slowest: number } {
  let totalMs = 0;
  let slowest = 0;
  for (const lap of s.laps) {
    totalMs += lap.ms;
    if (lap.ms > slowest) {
      slowest = lap.ms;
    }
  }
  return { totalMs, slowest };
}

/** Render one closed session as a report line. */
function report(s: Session): string {
  const { totalMs, slowest } = summarize(s);
  let line = `session@${secs(s.startedAt / 1000)}s laps=${s.laps.length} total=${secs(totalMs)}s slowest=${secs(slowest)}s`;
  let prev: Lap | null = null;
  for (const lap of s.laps) {
    line += ` | L${lap.index}:${secs(lap.ms)}s (${pace(lap, prev)})`;
    prev = lap;
  }
  return line;
}

// ── Hardware ───────────────────────────────────────────────────────────────
const pot = new ADC(PA1);
const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);

let pressed = false;
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  pressed = true;
});

// ── Watch state ────────────────────────────────────────────────────────────
let state: RunState = RunState.Idle;
let current: Session | null = null;
let lapStart = 0;
let history: Session[] = [];

UART0.writeLine(`[boot] stopwatch up — arm pot below ${ARM_MV}mV, button starts/stops`);

while (true) {
  const mv = pot.readMillivolts();

  // Button press advances the state machine.
  if (pressed) {
    pressed = false;
    switch (state) {
      case RunState.Idle:
        if (mv < ARM_MV) {
          state = RunState.Armed;
          UART0.writeLine(`armed (${secs(mv)}mV dial) — press to start`);
        } else {
          UART0.writeLine(`dial too high (${secs(mv)}mV) — lower the pot to arm`);
        }
        break;
      case RunState.Armed:
        state = RunState.Running;
        current = { startedAt: Time.now(), closedAt: 0, laps: [] };
        lapStart = Time.now();
        Trace.mark('run-start');
        UART0.writeLine('running — press to close the session');
        break;
      case RunState.Running: {
        const now = Time.now();
        const lapMs = now - lapStart;
        if (current !== null && lapMs >= LAP_MIN_MS) {
          const lap: Lap = { index: current.laps.length + 1, ms: lapMs };
          current.laps.push(lap);
        }
        if (current !== null) {
          current.closedAt = now;
          if (current.laps.length > 0) {
            history.push(current);
          }
          UART0.writeLine(report(current));
        }
        state = RunState.Idle;
        current = null;
        Trace.mark('run-end');
        break;
      }
      default:
        state = RunState.Idle;
        break;
    }
  }

  // Live lap split while running (a lap closes automatically every 5 s).
  if (state === RunState.Running && current !== null) {
    const now = Time.now();
    if (now - lapStart >= 5000) {
      const lap: Lap = { index: current.laps.length + 1, ms: now - lapStart };
      current.laps.push(lap);
      lapStart = now;
      UART0.writeLine(`lap ${lap.index}: ${secs(lap.ms)}s`);
    }
    led.set(true);
  } else {
    led.set(state === RunState.Armed ? !led.get() : false);
  }

  // History grows unbounded by design; keep the report bounded.
  if (history.length > MAX_SESSIONS) {
    history = history.slice(history.length - MAX_SESSIONS);
    UART0.writeLine(`[trim] history capped at ${MAX_SESSIONS} sessions`);
  }

  Time.sleep(50);
}
