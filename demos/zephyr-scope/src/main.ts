// ---------------------------------------------------------------------------
// main.ts — ASCII oscilloscope (waveform synth on PWM → ADC capture → UART)
//
// Board: esp32_devkitc/esp32/procpu. GPIO2 (the onboard blue LED) is the PWM
// output synthesizing the selected waveform; GPIO4 (adc1 ch0) is the captured
// analog input; console I/O rides the board's pre-wired UART0.
//
// Shape of the program:
//   • `synthTask`   — samples the active Waveform every 20 ms onto the PWM
//     duty (the "signal generator").
//   • `scopeTask`   — reads the ADC into a Trace ring buffer every 50 ms and
//     prints one rendered trace line plus rolling statistics every 2 s (the
//     "oscilloscope").
//   • `consoleTask` — line console: wave/freq/amp/stats/trace/sum/hist.
//   • `calibrate`   — a boot-time do/while settle probe (two ADC readings
//     within 25 mV of each other, or 20 tries).
//
// Language surface exercised on purpose (the reason this demo exists):
// switch dispatch on strings and on an enum, getters, static class state,
// do/while, ++/--, compound assignment (+= -= *= %=), string indexing,
// charCode checksums, array-valued function parameters and returns, for-of
// over an array and over a Map, and template literals with ternaries inside.
// (map/filter/reduce/join/split deliberately NOT used — they carry a clear
// build error on the fixed-size array model; explicit loops are the idiom.)
// ---------------------------------------------------------------------------

import { UART0, GPIO2, GPIO4, PWM, ADC, Time, Random } from '@typecad/hal';

// ── Configuration ──────────────────────────────────────────────────────────
const SYNTH_PERIOD_MS = 20;    // waveform output tick
const SAMPLE_PERIOD_MS = 50;   // scope input tick
const REPORT_EVERY = 40;       // scope pushes between rendered reports
const TRACE_COLS = 36;         // ASCII trace width
const ADC_FULL_MV = 3300;      // rail for vertical scaling
const MID_MV = ADC_FULL_MV / 2;

// Vertical shade ramp — index 0 is the floor, last is the ceiling.
const RAMP = ' .:-=+*#%@';

// Printable ASCII 32..126 — String.fromCharCode has no lowering; indexing
// this literal is the documented byte→char idiom.
const PRINTABLE =
  ' !"#$%&\'()*+,-./0123456789:;<=>?' +
  '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_' +
  '`abcdefghijklmnopqrstuvwxyz{|}~';

enum WaveKind { Sine, Square, Triangle, Noise }

// ── Waveform synthesis ─────────────────────────────────────────────────────
class Waveform {
  static nextId: number = 1;          // static state — ids survive retuning
  readonly id: number;
  readonly name: string;
  readonly kind: WaveKind;
  private _periodMs: number;
  amplitude: number;                  // 0.0..1.0

  constructor(name: string, kind: WaveKind, periodMs: number, amplitude: number) {
    this.id = Waveform.nextId++;
    this.name = name;
    this.kind = kind;
    this._periodMs = periodMs;
    this.amplitude = amplitude;
  }

  get periodMs(): number { return this._periodMs; }

  get freqHz(): number { return 1000 / this._periodMs; }

  setFreq(hz: number): void {
    if (hz > 0) {
      this._periodMs = Math.max(SYNTH_PERIOD_MS, 1000 / hz);
    }
  }

  /** Wave value at time tMs, normalized 0..1. */
  at(tMs: number): number {
    const ph = (tMs % this._periodMs) / this._periodMs;   // 0..1
    switch (this.kind) {
      case WaveKind.Sine:
        return 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
      case WaveKind.Square:
        return ph < 0.5 ? 1.0 : 0.0;
      case WaveKind.Triangle:
        return ph < 0.5 ? 2 * ph : 2 * (1 - ph);
      case WaveKind.Noise:
        return Random.between(0, 1001) / 1000;
    }
    return 0;
  }

  describe(): string {
    return `${this.name}#${this.id} f=${this.freqHz.toFixed(2)}Hz ` +
      `T=${this.periodMs.toFixed(0)}ms a=${(this.amplitude * 100).toFixed(0)}%`;
  }
}

const WAVES: Waveform[] = [
  new Waveform('sine', WaveKind.Sine, 2000, 0.60),
  new Waveform('square', WaveKind.Square, 1600, 0.50),
  new Waveform('triangle', WaveKind.Triangle, 2400, 0.70),
  new Waveform('noise', WaveKind.Noise, 2000, 0.40),
];
let waveIdx = 0;

// ── Trace ring buffer + statistics ─────────────────────────────────────────
class Trace {
  private readonly _cap: number;
  private readonly _samples: number[];
  private _head = 0;
  private _fill = 0;

  constructor(cap: number) {
    this._cap = cap;
    this._samples = new Array<number>(cap);
  }

  push(mv: number): void {
    this._samples[this._head] = mv;
    this._head = (this._head + 1) % this._cap;
    if (this._fill < this._cap) { this._fill++; }
  }

  count(): number { return this._fill; }

  min(): number {
    if (this._fill === 0) { return 0; }
    let lo = this._samples[0];
    for (let i = 1; i < this._fill; i++) {
      if (this._samples[i] < lo) { lo = this._samples[i]; }
    }
    return lo;
  }

  max(): number {
    if (this._fill === 0) { return 0; }
    let hi = this._samples[0];
    for (let i = 1; i < this._fill; i++) {
      if (this._samples[i] > hi) { hi = this._samples[i]; }
    }
    return hi;
  }

  mean(): number {
    if (this._fill === 0) { return 0; }
    let sum = 0;
    for (let i = 0; i < this._fill; i++) { sum += this._samples[i]; }
    return sum / this._fill;
  }

  rms(): number {
    if (this._fill === 0) { return 0; }
    let acc = 0;
    for (let i = 0; i < this._fill; i++) {
      const d = this._samples[i] - MID_MV;
      acc += d * d;
    }
    return Math.sqrt(acc / this._fill);
  }

  /** Mid-crossing estimate of the input frequency, in Hz. */
  estFreqHz(): number {
    if (this._fill < 2) { return 0; }
    let crossings = 0;
    for (let i = 1; i < this._fill; i++) {
      const a = this._samples[i - 1] - MID_MV;
      const b = this._samples[i] - MID_MV;
      if ((a <= 0 && b > 0) || (a > 0 && b <= 0)) { crossings++; }
    }
    return (crossings * 500) / (this._fill * SAMPLE_PERIOD_MS);
  }

  /** One ASCII line: nearest-sample bucketing into `width` columns. */
  render(width: number): string {
    if (this._fill === 0) { return '(no samples)'; }
    let out = '|';
    for (let col = 0; col < width; col++) {
      const idx = (col * this._fill) / width;
      const v = this._samples[Math.floor(idx)];
      const level = Math.min(RAMP.length - 1, Math.floor((v * RAMP.length) / ADC_FULL_MV));
      out += RAMP[level];
    }
    return out + '|';
  }
}

// ── Hardware handles and shared state ──────────────────────────────────────
const outPwm = new PWM(GPIO2, { periodNs: 1000000 });   // 1 kHz carrier on the LED
const sense = new ADC(GPIO4);                           // adc1 ch0
const trace = new Trace(96);
const useCounts = new Map<string, number>();
let traceHold = false;

// HAL instance calls resolve inline in free functions/tasks; route the PWM
// through one helper so the lowering applies uniformly.
function setDuty(duty: number): void {
  outPwm.setDuty(duty);
}

// ── Small utilities ────────────────────────────────────────────────────────
function parseUnsigned(s: string): number {
  if (s.length === 0) { return -1; }
  let v = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 48 || code > 57) { return -1; }
    v = v * 10 + (code - 48);
  }
  return v;
}

/** Rolling string checksum (exact in both JS doubles and int32): h ← 31h + c. */
function checksum(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) {
    h *= 31;
    h += s.charCodeAt(i);
    h %= 1000003;
  }
  return h;
}

// Token/arg passing: the tokenizer fills module-level slots; argsFrom lifts a
// tail slice into a fresh local array (array-valued returns cross the
// lowering via the StaticArray promotion — one of the probes this demo runs).
const MAX_TOKENS = 16;
const gTokens = new Array<string>(MAX_TOKENS);
let gTokenCount = 0;

function tokenizeInto(line: string): number {
  let count = 0;
  let i = 0;
  while (i < line.length && count < MAX_TOKENS) {
    while (i < line.length && line.charAt(i) === ' ') { i++; }
    if (i >= line.length) { break; }
    const start = i;
    while (i < line.length && line.charAt(i) !== ' ') { i++; }
    gTokens[count] = line.substring(start, i);
    count++;
  }
  return count;
}

function argsFrom(start: number): string[] {
  const out: string[] = [];
  for (let i = start; i < gTokenCount; i++) {
    out.push(gTokens[i]);
  }
  return out;
}

const useOrder: string[] = [];

function bump(name: string): void {
  const prev = useCounts.has(name) ? useCounts.get(name)! : 0;
  useCounts.set(name, prev + 1);
  if (!useOrder.includes(name)) {
    useOrder.push(name);
  }
}

// ── Commands ───────────────────────────────────────────────────────────────
const HELP_TEXT = [
  'wave <sine|square|triangle|noise>  pick the synthesized waveform',
  'freq <hz>                          retune the waveform (>= 0.5 Hz)',
  'amp <0..100>                       output amplitude',
  'stats                              window statistics + est. frequency',
  'trace                              render the captured window',
  'sum <n> [n...]                     reduce/map/join over the arguments',
  'hist                               command usage counters',
  'hold | run                         pause / resume scope printing',
];

function cmdWave(args: string[]): boolean {
  if (args.length < 1) {
    UART0.writeLine('usage: wave <sine|square|triangle|noise>');
    return false;
  }
  const want = args[0].toLowerCase();
  for (let i = 0; i < WAVES.length; i++) {
    if (WAVES[i].name === want) {
      waveIdx = i;
      UART0.writeLine(`wave → ${WAVES[i].describe()}`);
      return true;
    }
  }
  UART0.writeLine(`unknown wave: ${want} (sine|square|triangle|noise)`);
  return false;
}

function cmdFreq(args: string[]): boolean {
  const hz = args.length > 0 ? parseUnsigned(args[0]) : -1;
  if (hz <= 0) {
    UART0.writeLine('usage: freq <hz> (integer, >= 1)');
    return false;
  }
  WAVES[waveIdx].setFreq(hz);
  UART0.writeLine(`retuned → ${WAVES[waveIdx].describe()}`);
  return true;
}

function cmdAmp(args: string[]): boolean {
  const pct = args.length > 0 ? parseUnsigned(args[0]) : -1;
  if (pct < 0 || pct > 100) {
    UART0.writeLine('usage: amp <0..100>');
    return false;
  }
  WAVES[waveIdx].amplitude = pct / 100;
  UART0.writeLine(`amplitude → ${pct}%`);
  return true;
}

function cmdStats(): boolean {
  const spread = trace.max() - trace.min();
  UART0.write(`n=${trace.count()} `);
  UART0.write(`min=${trace.min().toFixed(0)}mV `);
  UART0.write(`max=${trace.max().toFixed(0)}mV `);
  UART0.write(`mean=${trace.mean().toFixed(1)}mV `);
  UART0.write(`rms=${trace.rms().toFixed(1)}mV `);
  UART0.write(`pp=${spread.toFixed(0)}mV `);
  UART0.writeLine(`est=${trace.estFreqHz().toFixed(2)}Hz`);
  return true;
}

function cmdTrace(): boolean {
  UART0.writeLine(trace.render(TRACE_COLS));
  UART0.writeLine('+' + '-'.repeat(TRACE_COLS) + '+');
  const lo = (trace.min() / 1000).toFixed(1);
  const hi = (trace.max() / 1000).toFixed(2);
  UART0.writeLine(`${lo.padStart(5)}V .. ${hi.padEnd(5)}V  ${WAVES[waveIdx].describe()}`);
  return true;
}

function cmdSum(args: string[]): boolean {
  if (args.length === 0) {
    UART0.writeLine('usage: sum <n> [n...]');
    return false;
  }
  const vals: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const v = parseUnsigned(args[i]);
    if (v < 0) {
      UART0.writeLine(`not a number: ${args[i]}`);
      return false;
    }
    vals.push(v);
  }
  let total = 0;
  for (let i = 0; i < vals.length; i++) { total += vals[i]; }
  const spread = total > 0 ? 100 * (trace.max() - trace.min()) / total : 0;
  UART0.writeLine(`n=${vals.length} sum=${total} mean=${(total / vals.length).toFixed(1)}`);
  let doubled = 'doubled:';
  for (let i = 0; i < vals.length; i++) { doubled += ' ' + (vals[i] * 2).toFixed(0); }
  UART0.writeLine(doubled);
  UART0.writeLine(`window-pp as % of sum: ${spread.toFixed(2)}%`);
  return true;
}

function cmdHist(): boolean {
  if (useOrder.length === 0) {
    UART0.writeLine('no commands run yet');
    return true;
  }
  // for-of over the Map's entries — a deliberate probe: the entries iterator
  // must lower on this target for this command to print anything.
  let total = 0;
  for (const entry of useCounts) {
    total += entry[1];
  }
  let line = '';
  for (let i = 0; i < useOrder.length; i++) {
    const n = useOrder[i];
    line += (i > 0 ? ' ' : '') + n + ':' + (useCounts.has(n) ? useCounts.get(n) : 0);
  }
  UART0.writeLine(line);
  UART0.writeLine(`total=${total} over ${useOrder.length} commands`);
  return true;
}

// ── Dispatch ───────────────────────────────────────────────────────────────
function dispatch(line: string): void {
  gTokenCount = tokenizeInto(line);
  if (gTokenCount === 0) { return; }
  const verb = gTokens[0].toLowerCase();
  const args = argsFrom(1);

  let ok: boolean;
  switch (verb) {
    case 'help':
      for (const h of HELP_TEXT) { UART0.writeLine('  ' + h); }
      ok = true;
      break;
    case 'wave':   ok = cmdWave(args); break;
    case 'freq':   ok = cmdFreq(args); break;
    case 'amp':    ok = cmdAmp(args); break;
    case 'stats':  ok = cmdStats(); break;
    case 'trace':  ok = cmdTrace(); break;
    case 'sum':    ok = cmdSum(args); break;
    case 'hist':   ok = cmdHist(); break;
    case 'hold':   traceHold = true;  UART0.writeLine('scope printing paused'); ok = true; break;
    case 'run':    traceHold = false; UART0.writeLine('scope printing resumed'); ok = true; break;
    default:
      UART0.writeLine(`unknown command: ${verb} (try help) chk=0x${checksum(line).toString(16).toUpperCase().padStart(6, '0')}`);
      return;
  }
  bump(verb);
  if (!ok) { UART0.writeLine('(usage error — see help)'); }
}

// ── Boot-time settle probe (do/while) ──────────────────────────────────────
async function calibrate() {
  UART0.writeLine('[cal] waiting for a stable input...');
  let prev = sense.readMillivolts();
  let tries = 0;
  do {
    await Time.sleep(50);
    const cur = sense.readMillivolts();
    const delta = Math.abs(cur - prev);
    prev = cur;
    if (delta <= 25) {
      UART0.writeLine(`[cal] settled at ${cur.toFixed(0)}mV after ${tries} tries`);
      return;
    }
    tries++;
  } while (tries < 20);
  UART0.writeLine('[cal] input never settled — continuing anyway');
}

// ── Tasks ──────────────────────────────────────────────────────────────────
async function synthTask() {
  let t = 0;
  while (true) {
    const w = WAVES[waveIdx];
    t += SYNTH_PERIOD_MS;
    const duty = w.at(t) * w.amplitude;
    setDuty(duty);
    await Time.sleep(SYNTH_PERIOD_MS);
  }
}

async function scopeTask() {
  let sinceReport = 0;
  while (true) {
    trace.push(sense.readMillivolts());
    sinceReport++;
    if (!traceHold && sinceReport >= REPORT_EVERY) {
      sinceReport = 0;
      UART0.writeLine(trace.render(TRACE_COLS));
    }
    await Time.sleep(SAMPLE_PERIOD_MS);
  }
}

async function consoleTask() {
  let line = '';
  while (true) {
    while (UART0.available() > 0) {
      const b = UART0.read();
      if (b === 13 || b === 10) {
        UART0.writeLine('');
        dispatch(line);
        line = '';
      } else if (b === 8 || b === 127) {
        if (line.length > 0) {
          line = line.substring(0, line.length - 1);
          UART0.write('\b \b');
        }
      } else if (b >= 32 && b <= 126) {
        const ch = PRINTABLE.charAt(b - 32);
        line += ch;
        UART0.write(ch);
      }
    }
    await Time.sleep(20);
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
UART0.writeLine('[boot] zephyr-scope — type help');
UART0.writeLine(`[boot] waves=${WAVES.length} ramp="${RAMP}" duty=${(WAVES[0].amplitude * 100).toFixed(0)}%`);
UART0.writeLine(`[boot] first wave: ${WAVES[0].describe()}`);
let bootIds = 'ids:';
for (let i = 0; i < WAVES.length; i++) { bootIds += ' ' + WAVES[i].id.toFixed(0); }
UART0.writeLine(`[boot] ${bootIds} (static counter shared)`);
calibrate();
synthTask();
scopeTask();
consoleTask();
