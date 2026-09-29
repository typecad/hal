// ---------------------------------------------------------------------------
// main.ts — sentence router (Black Pill + console UART + pot + button)
//
// UART0 receives `$TT,KEY,ARGS*CS` sentences; Sentence.parse checksums and
// splits them, the Field hierarchy renders each field, and Stats aggregates
// per-talker counts. The pot (PA1) synthesizes a TMP sentence every few
// seconds so the pipeline runs with nothing on the RX line; the KEY button
// forces a report. A heartbeat thread blinks the LED. The boot self-test
// pushes a canned batch (including one corrupt checksum) through the same
// parse path the console uses.
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON, PA1,
  ADC, UART0,
  Time, Thread, Trace,
} from '@typecad/hal';
import {
  Phase, FieldKind,
  Sentence, TextField, ScaledField,
} from './sentence.js';
import { Stats } from './report.js';

// ── Tunables ───────────────────────────────────────────────────────────────
const REPORT_EVERY_MS = 10000;
const POT_EVERY_MS = 2000;
const LOOP_MS = 40;

// ── Hardware handles ───────────────────────────────────────────────────────
const pot = new ADC(PA1);
const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);

// Button presses arrive from interrupt context as a flag only.
let forceReport = false;
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  forceReport = true;
});

// ── Heartbeat thread — LED blink, independent of the router loop ───────────
const heartbeat = new Thread(0, { stackKb: 1 });
heartbeat.start(() => {
  while (true) {
    led.toggle();
    Time.sleep(500);
  }
});

// ── Byte-stream line assembler over UART0 ──────────────────────────────────
// String.fromCharCode is not lowered; indexing a literal of the printable
// range IS the documented idiom for byte → char.
const PRINTABLE =
  ' !"#$%&\'()*+,-./0123456789:;<=>?' +
  '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_' +
  '`abcdefghijklmnopqrstuvwxyz{|}~';

function charOf(b: number): string {
  if (b >= 32 && b < 127) {
    return PRINTABLE[b - 32];
  }
  return '';
}

const CR = '\r'.charCodeAt(0);
const LF = '\n'.charCodeAt(0);

class LineAssembler {
  private _buf: string;
  private readonly _cap: number;

  constructor(cap: number) {
    this._buf = '';
    this._cap = cap;
  }

  /** Feed one byte; returns the completed line, or null while incomplete. */
  feed(b: number): string | null {
    if (b === CR || b === LF) {
      const line = this._buf;
      this._buf = '';
      return line.length > 0 ? line : null;
    }
    if (this._buf.length < this._cap) {
      this._buf += charOf(b);
    }
    return null;
  }
}

// ── Router state ───────────────────────────────────────────────────────────
const stats = new Stats();
const assembler = new LineAssembler(64);

/** Feed one line through parse + aggregation; true when it decoded. */
function route(line: string): boolean {
  const s = Sentence.parse(line);
  if (s === null) {
    UART0.writeLine(`? rejected: ${line}`);
    return false;
  }
  stats.observe(s);
  Trace.event('sentence', s.fieldCount);
  UART0.writeLine(`[${phaseTag(stats.phase)}] ${s.describe()}`);
  return true;
}

function phaseTag(p: Phase): string {
  switch (p) {
    case Phase.Alarm:
      return '!!';
    case Phase.Sync:
      return 'sy';
    case Phase.Active:
      return 'ac';
    default:
      return '..';
  }
}

// ── Boot self-test: canned sentences, one with a corrupted checksum ────────
const SELFTEST_BODIES = [
  'TC,STA,SYNC',
  'BD,TMP,254',
  'GN,BAT,3987',
  'GN,BAT,4101,96',
  'WI,EVT,3',
  'TC,STA,ACTIVE',
];
const okCount = runSelfTest(SELFTEST_BODIES);

function runSelfTest(bodies: string[]): number {
  let ok = 0;
  for (const body of bodies) {
    if (route(Sentence.frame(body))) {
      ok += 1;
    }
  }
  // Corrupt the checksum: same body, wrong tag must be rejected.
  route(`$${SELFTEST_BODIES[0]}*00`);
  return ok;
}

UART0.writeLine(`[boot] sentence-router ready — selftest ${okCount}/${SELFTEST_BODIES.length}, fields live`);

let lastReport = Time.now();
let lastPot = Time.now();
let loops = 0;

while (true) {
  // ── Console RX: assemble bytes, route completed lines ────────────────────
  while (UART0.available() > 0) {
    const line = assembler.feed(UART0.read());
    if (line !== null) {
      route(line);
    }
  }

  // ── Pot: synthesize a TMP sentence from the real reading ─────────────────
  if (Time.now() - lastPot >= POT_EVERY_MS) {
    lastPot = Time.now();
    const mv = pot.readMillivolts();
    const raw = Math.round(mv / 10);
    route(Sentence.frame(`TC,TMP,${raw}`));
  }

  // ── Periodic / forced report ─────────────────────────────────────────────
  if (Time.now() - lastReport >= REPORT_EVERY_MS || forceReport) {
    lastReport = Time.now();
    forceReport = false;
    Trace.mark('report');
    UART0.writeLine(stats.render(10));
    UART0.writeLine(
      `decoded=${Sentence.decoded} rejected=${Sentence.rejected} loops=${loops.toFixed(0)} peak=${stats.lastOf('GN').slice(0, 16)}`
    );
  }

  loops += 1;
  Time.sleep(LOOP_MS);
}
