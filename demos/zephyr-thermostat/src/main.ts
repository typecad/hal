// ---------------------------------------------------------------------------
// main.ts — a small thermostat (Black Pill + console UART + pot + button)
//
// The pot stands in for a temperature sensor (0..3300 mV → 0..40 °C). The
// last WINDOW readings average into the control decision, a hysteresis band
// around the setpoint drives the LED, and the KEY button cycles
// off → heat → cool. Every REPORT_EVERY samples the console prints one line
// with the current/average temperature, the mode, and a five-cell bar.
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON, PA1,
  ADC, UART0,
  Time, Trace,
} from '@typecad/hal';

// ── Tunables ───────────────────────────────────────────────────────────────
const WINDOW = 12;
const SETPOINT = 22.0;
const HYST = 0.5;
const SAMPLE_MS = 500;
const REPORT_EVERY = 20;

enum Mode { Off, Heat, Cool }

function modeName(m: Mode): string {
  switch (m) {
    case Mode.Heat:
      return 'HEAT';
    case Mode.Cool:
      return 'COOL';
    default:
      return 'off';
  }
}

/** Fixed-capacity ring of the most recent samples. */
class Ring {
  private data: number[] = [];
  private readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  push(v: number): void {
    if (this.data.length >= this.cap) {
      this.data.shift();
    }
    this.data.push(v);
  }

  get size(): number {
    return this.data.length;
  }

  min(): number {
    if (this.data.length === 0) {
      return 0;
    }
    let m = this.data[0];
    for (const v of this.data) {
      if (v < m) {
        m = v;
      }
    }
    return m;
  }

  max(): number {
    if (this.data.length === 0) {
      return 0;
    }
    let m = this.data[0];
    for (const v of this.data) {
      if (v > m) {
        m = v;
      }
    }
    return m;
  }

  avg(): number {
    if (this.data.length === 0) {
      return 0;
    }
    let sum = 0;
    for (const v of this.data) {
      sum += v;
    }
    return sum / this.data.length;
  }
}

/** Five-cell bar: `##...` — filled cells track value/max. */
function bar(value: number, max: number): string {
  const n = Math.max(0, Math.min(5, Math.round((value / max) * 5)));
  let s = '';
  for (let i = 0; i < n; i += 1) {
    s += '#';
  }
  while (s.length < 5) {
    s += '.';
  }
  return s;
}

// ── Hardware ───────────────────────────────────────────────────────────────
const pot = new ADC(PA1);
const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);

// Button presses arrive from interrupt context as a flag only.
let pressed = false;
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  pressed = true;
});

// ── State ──────────────────────────────────────────────────────────────────
const ring = new Ring(WINDOW);
let mode: Mode = Mode.Off;
let samples = 0;

UART0.writeLine(`[boot] thermostat up — setpoint ${SETPOINT.toFixed(1)}C, window ${WINDOW}`);

while (true) {
  const mv = pot.readMillivolts();
  const temp = (mv / 3300.0) * 40.0;
  ring.push(temp);
  samples += 1;

  // Button cycles off → heat → cool → off.
  if (pressed) {
    pressed = false;
    mode = ((mode + 1) % 3) as Mode;
    Trace.event('mode', mode);
    UART0.writeLine(`mode ${modeName(mode)}`);
  }

  const avg = ring.avg();

  // Hysteresis control around the setpoint.
  if (mode === Mode.Heat) {
    if (avg < SETPOINT - HYST) {
      led.set(true);
    } else if (avg > SETPOINT + HYST) {
      led.set(false);
    }
  } else if (mode === Mode.Cool) {
    if (avg > SETPOINT + HYST) {
      led.set(true);
    } else if (avg < SETPOINT - HYST) {
      led.set(false);
    }
  } else {
    led.set(false);
  }

  // Periodic one-line report.
  if (samples % REPORT_EVERY === 0) {
    UART0.writeLine(
      `t=${samples} now=${temp.toFixed(1)} avg=${avg.toFixed(1)} ` +
      `[${ring.min().toFixed(1)}..${ring.max().toFixed(1)}] ` +
      `${modeName(mode)} ${bar(avg, 40)}`
    );
  }

  Time.sleep(SAMPLE_MS);
}
