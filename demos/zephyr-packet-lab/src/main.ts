// ---------------------------------------------------------------------------
// main.ts — Packet Lab (Black Pill + console UART + LED + KEY button)
//
// Three synthetic sensors produce readings; `frame()` serializes each into an
// escaped byte packet (FLAG/ESC byte-stuffing + CRC-8); `parse()` walks the
// merged byte stream back out with a small state machine; good frames land in
// per-channel tallies (a Map<string, Tally>), bad ones are counted as drops.
// The console prints a sorted leaderboard, a hex dump of one channel's
// samples, and answers "gain expressions" ("2*3+4") with a tiny recursive
// descent evaluator. The KEY button toggles verbose mode.
//
// Axes this demo deliberately stresses, beyond the earlier hardening demos:
// tagged unions with literal discriminants, destructuring (array, object,
// renamed, in params), rest/spread calls, closures returned from factories
// and stored in record fields, statics + getters/setters on one class,
// labeled `continue`, string indexing/comparison, toString(radix).
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON,
  UART0,
  Time, Random,
} from '@typecad/hal';

// ── Tunables ───────────────────────────────────────────────────────────────
const FLAG = 0x7e;
const ESC = 0x7d;
const XOR = 0x20;
const CYCLES = 40;
const REPORT_EVERY = 8;
const SAMPLE_MS = 400;

// Single-char lookup table (String.fromCharCode is not lowered — by design).
const GLYPHS = ['T', 'H', 'P', 'L'];

// ── Tagged events (TEMP: struct-with-discriminator while unions are probed) ─
type Reading = { label: string; milli: number };
type PktEvent = { kind: string; label: string; milli: number; why: string };
type Eval = { ok: boolean; value: number; why: string };
type Row = { label: string; mean: number; spread: number };

// ── Tally: statics + getters/setters + hex dump ────────────────────────────
class Tally {
  static frames = 0;
  static drops = 0;

  samples: number[] = [];
  cap = 8;
  label = '';

  constructor(label: string, first: number) {
    this.label = label;
    this.samples.push(first);
  }

  add(v: number): void {
    if (this.samples.length >= this.cap) {
      this.samples.shift();
    }
    this.samples.push(v);
    Tally.frames += 1;
  }

  get size(): number {
    return this.samples.length;
  }

  get spread(): number {
    if (this.samples.length === 0) {
      return 0;
    }
    let lo = this.samples[0];
    let hi = this.samples[0];
    for (const v of this.samples) {
      if (v < lo) {
        lo = v;
      }
      if (v > hi) {
        hi = v;
      }
    }
    return hi - lo;
  }

  set limit(n: number) {
    if (n >= 2) {
      this.cap = n;
    }
  }

  mean(): number {
    if (this.samples.length === 0) {
      return 0;
    }
    let sum = 0;
    for (const v of this.samples) {
      sum += v;
    }
    return sum / this.samples.length;
  }

  hexDump(): string {
    let out = '';
    for (const v of this.samples) {
      const h = v.toString(16).toUpperCase().padStart(2, '0');
      out += h + ' ';
    }
    return out.trim();
  }

  static reset(): void {
    Tally.frames = 0;
    Tally.drops = 0;
  }
}

// ── Rest params, spread calls, closures ────────────────────────────────────
function spanOf(...vals: number[]): number {
  let lo = vals[0];
  let hi = vals[0];
  for (const v of vals) {
    if (v < lo) {
      lo = v;
    }
    if (v > hi) {
      hi = v;
    }
  }
  return hi - lo;
}

function peak(...vals: number[]): number {
  return Math.max(...vals);
}

function makeScale(k: number): (x: number) => number {
  return (x: number): number => x * k;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

// ── Framing: CRC-8 + byte stuffing ─────────────────────────────────────────
function crc8(bytes: number[]): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

function frame(seq: number, r: Reading): number[] {
  const idx = GLYPHS.indexOf(r.label);
  // NOTE: annotated number[] — an unannotated literal of bitwise expressions
  // infers std::vector<int>, which does not convert to the number[] parameter
  // (the engine's int-vs-double number-model boundary).
  const payload: number[] = [
    seq & 0xff,
    (idx & 0xff) << 4,
    (r.milli >> 8) & 0xff,
    r.milli & 0xff,
  ];
  const crc = crc8(payload);
  const raw = [...payload, crc];
  const out: number[] = [FLAG];
  for (const b of raw) {
    if (b === FLAG || b === ESC) {
      out.push(ESC, b ^ XOR);
    } else {
      out.push(b);
    }
  }
  out.push(FLAG);
  return out;
}

// ── Parser: state machine over the merged stream ───────────────────────────
function parse(stream: number[]): PktEvent[] {
  const events: PktEvent[] = [];
  let i = 0;
  while (i < stream.length) {
    if (stream[i] === FLAG) {
      i += 1;
      continue;
    }
    // Garbage before the first flag — drop one byte.
    let body: number[] = [];
    let closed = false;
    while (i < stream.length) {
      const c = stream[i];
      if (c === FLAG) {
        closed = body.length > 0;
        break;
      }
      if (c === ESC) {
        i += 1;
        if (i >= stream.length) {
          break;
        }
        body.push((stream[i] ^ XOR) & 0xff);
      } else {
        body.push(c);
      }
      i += 1;
    }
    if (!closed) {
      events.push({ kind: 'drop', label: '', milli: 0, why: 'unterminated' });
      break;
    }
    i += 1;
    if (body.length !== 5) {
      events.push({ kind: 'drop', label: '', milli: 0, why: 'length' });
      continue;
    }
    const [seq, tag, hi, lo, crc] = body;
    const check = crc8([seq, tag, hi, lo]);
    if (check !== crc) {
      events.push({ kind: 'drop', label: '', milli: 0, why: 'crc' });
      continue;
    }
    const glyph = GLYPHS[(tag >> 4) & 0x0f] ?? '?';
    const milli = ((hi & 0xff) << 8) | (lo & 0xff);
    events.push({ kind: 'frame', label: glyph, milli: milli, why: '' });
  }
  return events;
}

// ── Recording + leaderboard ────────────────────────────────────────────────
const tallies = new Map<string, Tally>();

function record(events: PktEvent[]): void {
  for (const e of events) {
    if (e.kind === 'frame') {
      const t = tallies.get(e.label);
      if (t === undefined) {
        tallies.set(e.label, new Tally(e.label, e.milli));
      } else {
        t.add(e.milli);
      }
    } else {
      Tally.drops += 1;
    }
  }
}

function padRow(r: Row): string {
  return r.label.padEnd(3) + r.mean.toFixed(1).padStart(9) + r.spread.toFixed(1).padStart(9);
}

function leaderboard(rows: Row[], limit: { take: number }): string {
  const copy = [...rows];
  // NOTE: expression-bodied — a block-bodied comparator with control flow
  // still declines the __tc_sort_fn lowering (see findings suite).
  copy.sort((a: Row, b: Row): number => (a.mean !== b.mean ? b.mean - a.mean : (a.label < b.label ? -1 : 1)));
  let out = '';
  for (let i = 0; i < copy.length && i < limit.take; i += 1) {
    out += padRow(copy[i]) + '\n';
  }
  return out;
}

// Destructured parameter — the span to normalize into [0, 10].
function norm({ mean, spread }: Row): number {
  const s = clamp(spread, 1, 2000);
  return (mean / 4000.0) * 10.0 + s / 1000.0;
}

// ── Recursive descent: "2*3+4" → 10 ────────────────────────────────────────
type Cursor = { src: string; pos: number };

function parseSum(c: Cursor): Eval {
  const first = parseTerm(c);
  if (!first.ok) {
    return first;
  }
  let total = first.value;
  while (c.pos < c.src.length && (c.src[c.pos] === '+' || c.src[c.pos] === '-')) {
    const op = c.src[c.pos];
    c.pos += 1;
    const rhs = parseTerm(c);
    if (!rhs.ok) {
      return rhs;
    }
    total = op === '+' ? total + rhs.value : total - rhs.value;
  }
  return { ok: true, value: total, why: '' };
}

function parseTerm(c: Cursor): Eval {
  const first = parseFactor(c);
  if (!first.ok) {
    return first;
  }
  let total = first.value;
  while (c.pos < c.src.length && (c.src[c.pos] === '*' || c.src[c.pos] === '/')) {
    const op = c.src[c.pos];
    c.pos += 1;
    const rhs = parseFactor(c);
    if (!rhs.ok) {
      return rhs;
    }
    total = op === '*' ? total * rhs.value : total / rhs.value;
  }
  return { ok: true, value: total, why: '' };
}

function parseFactor(c: Cursor): Eval {
  if (c.pos >= c.src.length) {
    return { ok: false, value: 0, why: 'end of expression' };
  }
  const ch = c.src[c.pos];
  if (ch === '(') {
    c.pos += 1;
    const inner = parseSum(c);
    if (!inner.ok) {
      return inner;
    }
    if (c.src[c.pos] !== ')') {
      return { ok: false, value: 0, why: 'missing )' };
    }
    c.pos += 1;
    return { ok: true, value: inner.value, why: '' };
  }
  if (ch === '-') {
    c.pos += 1;
    const v = parseFactor(c);
    if (!v.ok) {
      return v;
    }
    return { ok: true, value: -v.value, why: '' };
  }
  const start = c.pos;
  while (c.pos < c.src.length && c.src[c.pos] >= '0' && c.src[c.pos] <= '9') {
    c.pos += 1;
  }
  if (start === c.pos) {
    return { ok: false, value: 0, why: 'digit expected' };
  }
  const digits = c.src.slice(start, c.pos);
  return { ok: true, value: parseFloat(digits), why: '' };
}

function evalExpr(src: string): Eval {
  return parseSum({ src: src.trim(), pos: 0 });
}

// ── Hardware ───────────────────────────────────────────────────────────────
const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);

let pressed = false;
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  pressed = true;
});

// ── Sensors: closures stored in record fields ──────────────────────────────
const scale2x5 = makeScale(2.5);

const sensors = [
  { label: 'T', base: 2300, read: (): number => 2300 + Random.upTo(90) },
  { label: 'H', base: 1800, read: (): number => clamp(1800 + Random.upTo(400) - 200, 0, 4095) },
  { label: 'P', base: 3900, read: (): number => scale2x5(1560 + Random.upTo(16)) },
  { label: 'L', base: 40, read: (): number => 20 + Random.upTo(40) },
];

// ── Boot: evaluate the gain expressions ────────────────────────────────────
UART0.writeLine('[boot] packet lab up');
const GAINS = ['2*3+4', '(1+2)*4', '10-2-3', '100/5/2', '2*(3+4)-5'];
for (const g of GAINS) {
  const e = evalExpr(g);
  if (e.ok) {
    UART0.writeLine(`gain ${g} = ${e.value.toFixed(1)}`);
  } else {
    UART0.writeLine(`gain ${g} FAILED: ${e.why}`);
  }
}
UART0.writeLine(`span(3,9,4)=${spanOf(3, 9, 4)} peak(2,7,5)=${peak(2, 7, 5)}`);

// ── Main loop ──────────────────────────────────────────────────────────────
let verbose = false;
let seq = 0;

for (let cycle = 0; cycle < CYCLES; cycle += 1) {
  // Build this cycle's merged stream.
  const stream: number[] = [];

  build:
  for (let s = 0; s < sensors.length; s += 1) {
    if ((cycle + s) % 7 === 0) {
      continue build; // one sensor sits out occasionally
    }
    // NOTE: annotated — an `auto` const deduced from a record field is
    // unrecorded in the HAL template builder's type scope, which then treats
    // it as numeric (see findings suite).
    const label: string = sensors[s].label;
    const { base } = sensors[s];
    const milli = clamp(sensors[s].read(), 0, 65000);
    seq += 1;
    const packet = frame(seq, { label: label, milli: milli });
    for (const b of packet) {
      stream.push(b);
    }
    if (verbose) {
      UART0.writeLine(`tx ${label} base=${base} milli=${milli}`);
    }
  }

  // Corrupt one byte in roughly one cycle of five — the parser must cope.
  if (Random.upTo(5) === 0 && stream.length > 4) {
    const at = 1 + Random.upTo(stream.length - 2);
    stream[at] = stream[at] ^ 0x01;
  }

  const events = parse(stream);
  record(events);

  led.set(cycle % 2 === 0);

  if (pressed) {
    pressed = false;
    verbose = !verbose;
    UART0.writeLine(`verbose ${verbose ? 'on' : 'off'}`);
  }

  if ((cycle + 1) % REPORT_EVERY === 0) {
    // NOTE: named rowsNow — the IR prescan's array bookkeeping is
    // name-keyed and program-global, so a `rows` here poisons leaderboard's
    // `rows` parameter (see findings suite).
    const rowsNow: Row[] = [];
    for (const g of GLYPHS) {
      const t = tallies.get(g);
      if (t === undefined) {
        continue;
      }
      rowsNow.push({ label: g, mean: t.mean(), spread: t.spread });
    }
    const t = tallies.get('T');
    const dump = t === undefined ? '-' : t.hexDump();
    UART0.writeLine(`#${cycle + 1} frames=${Tally.frames} drops=${Tally.drops} norm(T)=${rowsNow.length > 0 ? norm(rowsNow[0]).toFixed(2) : '0.00'}`);
    UART0.writeLine(leaderboard(rowsNow, { take: 4 }) + `T hex ${dump}`);
  }

  Time.sleep(SAMPLE_MS);
}

UART0.writeLine('[done] packet lab complete');

while (true) {
  Time.sleep(1000);
}
