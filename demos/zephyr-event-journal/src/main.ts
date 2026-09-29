// ---------------------------------------------------------------------------
// main.ts — event journal (Black Pill + console UART + pot + button)
//
// The pot is sampled into a journal of Reading records (plain object
// literals — the data-record shape, not classes); the button logs a manual
// reading; an async reporter task prints a summary every few seconds
// cooperatively while the main loop keeps sampling; a heartbeat task blinks
// the LED. Peak detection and tag counts walk the journal with plain loops.
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON, PA1,
  ADC, UART0,
  Time, Trace,
} from '@typecad/hal';

// ── Tunables ───────────────────────────────────────────────────────────────
const SAMPLE_MS = 200;
const REPORT_EVERY_MS = 5000;
const ALARM_MV = 2400;

/** One journaled sample — the data-record shape (a plain object). */
type Reading = {
  tMs: number;
  mv: number;
  tag: string;
};

/** Manual bounds, retuned by the reporter when a peak lands outside. */
const bounds = { low: 3300, high: 0 };

function makeReading(tMs: number, mv: number, tag: string): Reading {
  return { tMs, mv, tag };
}

/** Format a millivolt value with a default of one fractional digit. */
function fmt(v: number, digits = 1): string {
  return v.toFixed(digits);
}

/** Sum any number of values (rest parameter). */
function sum(...vals: number[]): number {
  let total = 0;
  for (const v of vals) {
    total += v;
  }
  return total;
}

/** Highest |mv| reading in the journal, or null when empty. */
function peak(journal: Reading[]): Reading | null {
  let best: Reading | null = null;
  for (const r of journal) {
    if (best === null || r.mv > best.mv) {
      best = r;
    }
  }
  return best;
}

/** Count readings carrying the tag. */
function countTag(journal: Reading[], tag: string): number {
  let n = 0;
  for (const r of journal) {
    if (r.tag === tag) {
      n += 1;
    }
  }
  return n;
}

// ── Hardware ───────────────────────────────────────────────────────────────
const pot = new ADC(PA1);
const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);

let manual = false;
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  manual = true;
});

// ── State ──────────────────────────────────────────────────────────────────
const journal: Reading[] = [];

/** Append one record, keeping the bounds honest. */
function logReading(tMs: number, mv: number, tag: string): void {
  journal.push(makeReading(tMs, mv, tag));
  if (mv < bounds.low) {
    bounds.low = mv;
  }
  if (mv > bounds.high) {
    bounds.high = mv;
  }
}

// ── Async tasks ────────────────────────────────────────────────────────────
async function reporter() {
  while (true) {
    await Time.sleep(REPORT_EVERY_MS);
    const p = peak(journal);
    if (p === null) {
      UART0.writeLine('[report] journal empty');
      continue;
    }
    const auto = countTag(journal, 'auto');
    const manualCount = countTag(journal, 'manual');
    Trace.event('journal', journal.length);
    UART0.writeLine(
      `[report] n=${journal.length} auto=${auto} manual=${manualCount} ` +
      `peak=${fmt(p.mv)}@${fmt(p.tMs / 1000, 0)}s ` +
      `range=[${fmt(bounds.low)}..${fmt(bounds.high)}] tag=${p.tag}`
    );
  }
}

async function heartbeat() {
  while (true) {
    led.toggle();
    await Time.sleep(400);
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
UART0.writeLine(`[boot] event-journal up — alarm ${ALARM_MV}mV, demo sum=${sum(1, 2, 3)}`);
reporter();
heartbeat();

let t = 0;

while (true) {
  const mv = pot.readMillivolts();
  t += SAMPLE_MS;

  if (manual) {
    manual = false;
    logReading(t, mv, 'manual');
  }
  logReading(t, mv, 'auto');

  if (mv >= ALARM_MV) {
    Trace.event('alarm', mv);
    UART0.writeLine(`[alarm] ${fmt(mv, 0)}mV at ${fmt(t / 1000, 0)}s`);
  }

  Time.sleep(SAMPLE_MS);
}
