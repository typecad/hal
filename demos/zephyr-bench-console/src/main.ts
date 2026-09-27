// ---------------------------------------------------------------------------
// main.ts — bench console (UART shell + ADC sampler + breathing LED)
//
// Board: esp32_devkitc/esp32/procpu. The onboard blue LED pad (GPIO2) is the
// PWM output; GPIO4 (adc1 ch0) is the sampled analog input. Console I/O
// rides the board's pre-wired UART0.
//
// Shape of the program:
//   • `consoleTask` — cooperative task polling UART0 for input lines,
//     tokenizing them with an explicit loop, and dispatching to a Command.
//   • `sampler`     — task reading ADC millivolts into a SampleStats ring
//     every second.
//   • `breather`    — task sweeping the LED duty when mode is Breath.
//   • `heartbeat`   — task printing an uptime line every 10 s.
//
// The command set (help/stats/hex/echo/seq/led/hist) is deliberately
// string/number-heavy: parsing, formatting, and aggregation over arrays,
// maps, and a small class hierarchy — the parts of JS most worth checking
// against the transpiler.
//
// Target notes (Zephyr's fixed-size runtime model): strings are bounded
// buffers, arrays are fixed-capacity, and String.fromCharCode / array
// filter/map/reduce/sort/join have no lowering — the tokenizer is an
// explicit loop, output folds are printed element-wise, and numeric parses
// are guarded by manual digit validation (C atoi's silent 0 for garbage
// would otherwise read as a valid value). Parsed tokens live in module
// level arrays (gTokens/gArgs) rather than array parameters — the natural
// embedded shape, and the one whose lowering this demo verifies.
// ---------------------------------------------------------------------------

import { UART0, GPIO2, GPIO4, PWM, ADC, Time } from '@typecad/hal';

// ── Console input table ────────────────────────────────────────────────────
// String.fromCharCode is not lowered; indexing a literal of the printable
// range IS the documented idiom for byte → char.
const PRINTABLE =
  ' !"#$%&\'()*+,-./0123456789:;<=>?' +
  '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_' +
  '`abcdefghijklmnopqrstuvwxyz{|}~';

enum LedMode { Off, Solid, Breath }

// ── Token/arg passing (module level — the embedded shape) ─────────────────
const MAX_TOKENS = 16;
const gTokens = new Array<string>(MAX_TOKENS);
let gTokenCount = 0;

const MAX_ARGS = 12;
const gArgs = new Array<string>(MAX_ARGS);
let gArgCount = 0;

// ── Small utilities ────────────────────────────────────────────────────────
class Util {
  /** Value of one hex digit character, or -1 when it is not a digit. */
  static hexNibble(c: string): number {
    const code = c.charCodeAt(0);
    if (code >= 48 && code <= 57) { return code - 48; }   // '0'..'9'
    if (code >= 97 && code <= 102) { return code - 87; }  // 'a'..'f'
    if (code >= 65 && code <= 70) { return code - 55; }   // 'A'..'F'
    return -1;
  }

  /** Parse an unsigned decimal token, or -1 when it is not all digits. */
  static parseUnsigned(s: string): number {
    if (s.length === 0) { return -1; }
    let v = 0;
    for (let i = 0; i < s.length; i = i + 1) {
      const code = s.charCodeAt(i);
      if (code < 48 || code > 57) { return -1; }
      v = v * 10 + (code - 48);
    }
    return v;
  }

  /** Format a byte count for the banner: 64 → "64", 4096 → "4.0k". */
  static shortCount(n: number): string {
    if (n >= 1024) {
      return (n / 1024).toFixed(1) + 'k';
    }
    return '' + n;
  }

  /** Right-align a number in `width` columns with spaces. */
  static padNum(v: number, width: number): string {
    const s = v.toFixed(0);
    const need = width - s.length;
    if (need <= 0) { return s; }
    return ' '.repeat(need) + s;
  }
}

function parseHex(s: string): number {
  let v = 0;
  for (let i = 0; i < s.length; i = i + 1) {
    const nib = Util.hexNibble(s.charAt(i));
    if (nib < 0) { return -1; }
    v = (v << 4) | nib;
  }
  return v;
}

/** Argument `i`, or `dflt` when the command was called with fewer. */
function argAt(i: number, dflt: string): string {
  return i < gArgCount ? gArgs[i] : dflt;
}

// ── Statistics over a fixed sample window ──────────────────────────────────
class SampleStats {
  private readonly _cap: number;
  private readonly _samples: number[];
  private _head: number;
  private _fill: number;

  constructor(cap: number) {
    this._cap = cap;
    this._samples = new Array<number>(cap);
    this._head = 0;
    this._fill = 0;
  }

  push(v: number): void {
    this._samples[this._head] = v;
    this._head = (this._head + 1) % this._cap;
    if (this._fill < this._cap) {
      this._fill = this._fill + 1;
    }
  }

  count(): number { return this._fill; }

  min(): number {
    if (this._fill === 0) { return 0; }
    let lo = this._samples[0];
    for (let i = 1; i < this._fill; i = i + 1) {
      if (this._samples[i] < lo) { lo = this._samples[i]; }
    }
    return lo;
  }

  max(): number {
    if (this._fill === 0) { return 0; }
    let hi = this._samples[0];
    for (let i = 1; i < this._fill; i = i + 1) {
      if (this._samples[i] > hi) { hi = this._samples[i]; }
    }
    return hi;
  }

  mean(): number {
    if (this._fill === 0) { return 0; }
    let sum = 0;
    for (let i = 0; i < this._fill; i = i + 1) {
      sum = sum + this._samples[i];
    }
    return sum / this._fill;
  }

  stddev(): number {
    if (this._fill < 2) { return 0; }
    const m = this.mean();
    let acc = 0;
    for (let i = 0; i < this._fill; i = i + 1) {
      const d = this._samples[i] - m;
      acc = acc + d * d;
    }
    return Math.sqrt(acc / (this._fill - 1));
  }
}

// ── Command hierarchy ──────────────────────────────────────────────────────
// Commands read their operands from the module-level gArgs/gArgCount pair —
// the parameterless embedded shape (array parameters don't cross the
// lowering on fixed-array targets).
class Command {
  name: string;
  help: string;

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  run(): boolean {
    UART0.write(this.name);
    UART0.writeLine(': not implemented');
    return false;
  }
}

class HelpCommand extends Command {
  constructor() {
    super('help', 'list the available commands');
  }

  override run(): boolean {
    for (const c of COMMANDS) {
      UART0.write('  ');
      UART0.write(c.name.padEnd(7));
      UART0.write(' ');
      UART0.writeLine(c.help);
    }
    return true;
  }
}

class StatsCommand extends Command {
  constructor() {
    super('stats', 'print the ADC sample statistics');
  }

  override run(): boolean {
    const n = stats.count();
    if (n === 0) {
      UART0.writeLine('no samples yet');
      return true;
    }
    UART0.write('n=');
    UART0.write(n);
    UART0.write(' min=');
    UART0.write(stats.min().toFixed(0));
    UART0.write('mV max=');
    UART0.write(stats.max().toFixed(0));
    UART0.write('mV mean=');
    UART0.write(stats.mean().toFixed(1));
    UART0.write('mV sd=');
    UART0.write(stats.stddev().toFixed(2));
    UART0.writeLine('mV');
    // A coarse level bar: mean mV bucketed into 8 bands of 400 mV.
    const band = Math.min(7, Math.floor(stats.mean() / 400));
    let bar = '';
    for (let i = 0; i <= band; i = i + 1) {
      bar = bar + '#';
    }
    UART0.write('level ');
    UART0.write((band + 1));
    UART0.write('/8 ');
    UART0.write(bar.padEnd(8));
    UART0.write(' ');
    UART0.write(Util.shortCount(n));
    UART0.writeLine(' samples');
    return true;
  }
}

class HexCommand extends Command {
  constructor() {
    super('hex', 'show a number in dec/hex/bin (0x prefix ok)');
  }

  override run(): boolean {
    const raw = argAt(0, '0');
    let value = 0;
    if (raw.startsWith('0x') || raw.startsWith('0X')) {
      value = parseHex(raw.substring(2));
      if (value < 0) {
        UART0.writeLine('bad hex literal: ' + raw);
        return false;
      }
    } else {
      value = Util.parseUnsigned(raw);
      if (value < 0) {
        UART0.writeLine('not a number: ' + raw);
        return false;
      }
    }
    UART0.write('dec=');
    UART0.write(value);
    UART0.write(' hex=0x');
    UART0.write(value.toString(16).toUpperCase().padStart(4, '0'));
    UART0.write(' bin=');
    UART0.writeLine(value.toString(2));
    return true;
  }
}

class EchoCommand extends Command {
  constructor() {
    super('echo', 'transform text: upper/lower/reverse/underscored');
  }

  override run(): boolean {
    let text = '';
    for (let i = 0; i < gArgCount; i = i + 1) {
      text = i === 0 ? gArgs[i] : text + ' ' + gArgs[i];
    }
    if (text.length === 0) {
      UART0.writeLine('usage: echo <text>');
      return false;
    }
    let rev = '';
    for (let i = text.length - 1; i >= 0; i = i - 1) {
      rev = rev + text.charAt(i);
    }
    UART0.writeLine('up  : ' + text.toUpperCase());
    UART0.writeLine('down: ' + text.toLowerCase());
    UART0.writeLine('rev : ' + rev);
    UART0.writeLine('und : ' + text.replace(' ', '_') + ' (' + text.length + ' chars)');
    return true;
  }
}

class SeqCommand extends Command {
  constructor() {
    super('seq', 'squares 1..n (default n=10, max 64)');
  }

  override run(): boolean {
    const n = Util.parseUnsigned(argAt(0, '10'));
    if (n < 1 || n > 64) {
      UART0.writeLine('usage: seq <1..64>');
      return false;
    }
    // Fold the squares element-wise: eight per console line keeps every
    // output piece inside the bounded-string model.
    let sum = 0;
    let line = 'squares:';
    for (let i = 1; i <= n; i = i + 1) {
      const sq = i * i;
      sum = sum + sq;
      line = `${line} ${sq.toFixed(0)}`;
      if (i % 8 === 0) {
        UART0.writeLine(line);
        line = '  ';
      }
    }
    if (line.length > 2) {
      UART0.writeLine(line);
    }
    UART0.write('sum: ');
    UART0.write(sum);
    UART0.write(' mean: ');
    UART0.writeLine((sum / n).toFixed(2));
    return true;
  }
}

class LedCommand extends Command {
  constructor() {
    super('led', 'led <0..100|off|breath> — LED control');
  }

  override run(): boolean {
    const a = argAt(0, '').toLowerCase();
    if (a === 'off') {
      ledMode = LedMode.Off;
      setLedDuty(0);
    } else if (a === 'breath') {
      ledMode = LedMode.Breath;
    } else {
      const pct = Util.parseUnsigned(a);
      if (pct < 0 || pct > 100) {
        UART0.writeLine('usage: led <0..100|off|breath>');
        return false;
      }
      ledMode = LedMode.Solid;
      setLedDuty(pct / 100);
    }
    return true;
  }
}

class HistCommand extends Command {
  constructor() {
    super('hist', 'command usage counters, most-used first');
  }

  override run(): boolean {
    if (useOrder.length === 0) {
      UART0.writeLine('no commands run yet');
      return true;
    }
    // Selection sort by use count (desc), then name — the explicit-loop
    // replacement for Array.sort(comparator) on this target.
    let total = 0;
    for (let i = 0; i < useOrder.length; i = i + 1) {
      let best = i;
      for (let j = i + 1; j < useOrder.length; j = j + 1) {
        const cj = countOf(useCounts, useOrder[j]);
        const cbest = countOf(useCounts, useOrder[best]);
        if (cj > cbest || (cj === cbest && useOrder[j] < useOrder[best])) {
          best = j;
        }
      }
      if (best !== i) {
        const tmp = useOrder[i];
        useOrder[i] = useOrder[best];
        useOrder[best] = tmp;
      }
      const c = countOf(useCounts, useOrder[i]);
      total = total + c;
      UART0.write('  ');
      UART0.write(useOrder[i].padEnd(7));
      UART0.write(Util.padNum(c, 4));
      UART0.writeLine('');
    }
    UART0.write('  total  ');
    UART0.write(Util.padNum(total, 4));
    UART0.writeLine('');
    return true;
  }
}

// ── Hardware handles and shared state ──────────────────────────────────────
const ledPwm = new PWM(GPIO2, { periodNs: 1000000 });   // 1 kHz on the blue LED
const sense = new ADC(GPIO4);                            // adc1 ch0
const stats = new SampleStats(64);

// HAL instance calls resolve inline in free functions/tasks; class methods
// route through this helper so the PWM lowering applies uniformly.
function setLedDuty(duty: number): void {
  ledPwm.setDuty(duty);
}

const useCounts = new Map<string, number>();
const useOrder: string[] = [];

const COMMANDS: Command[] = [
  new HelpCommand(),
  new StatsCommand(),
  new HexCommand(),
  new EchoCommand(),
  new SeqCommand(),
  new LedCommand(),
  new HistCommand(),
];

let ledMode = LedMode.Breath;

// ── Tokenizer + dispatch ───────────────────────────────────────────────────
// Splits on runs of spaces into the module-level gTokens — the explicit-loop
// replacement for String.split(' ').filter(t => t.length > 0) on this target.
function tokenizeInto(line: string): number {
  let count = 0;
  let i = 0;
  while (i < line.length && count < MAX_TOKENS) {
    while (i < line.length && line.charAt(i) === ' ') { i = i + 1; }
    if (i >= line.length) { break; }
    const start = i;
    while (i < line.length && line.charAt(i) !== ' ') { i = i + 1; }
    gTokens[count] = line.substring(start, i);
    count = count + 1;
  }
  return count;
}

function countOf(m: Map<string, number>, k: string): number {
  return m.has(k) ? m.get(k)! : 0;
}

function bump(name: string): void {
  useCounts.set(name, countOf(useCounts, name) + 1);
  if (!useOrder.includes(name)) {
    useOrder.push(name);
  }
}

function dispatch(line: string): void {
  const clean = line.trim();
  if (clean === '') { return; }
  if (clean.startsWith('#')) { return; }   // comment line

  gTokenCount = tokenizeInto(clean);
  if (gTokenCount === 0) { return; }

  const verb = gTokens[0].toLowerCase();
  gArgCount = 0;
  for (let i = 1; i < gTokenCount && gArgCount < MAX_ARGS; i = i + 1) {
    gArgs[gArgCount] = gTokens[i];
    gArgCount = gArgCount + 1;
  }

  for (const c of COMMANDS) {
    if (c.name === verb) {
      bump(verb);
      const ok = c.run();
      if (!ok) {
        UART0.writeLine('(usage error — see help)');
      }
      return;
    }
  }
  UART0.writeLine('unknown command: ' + verb + ' (try help)');
}

// ── Tasks ──────────────────────────────────────────────────────────────────
async function sampler() {
  while (true) {
    const mv = sense.readMillivolts();
    stats.push(mv);
    await Time.sleep(1000);
  }
}

async function breather() {
  let phase = 0;
  while (true) {
    if (ledMode === LedMode.Breath) {
      phase = (phase + 2) % 200;
      const tri = phase < 100 ? phase : (200 - phase);
      ledPwm.setDuty(tri / 100);
    }
    await Time.sleep(30);
  }
}

async function heartbeat() {
  let ticks = 0;
  while (true) {
    await Time.sleep(10000);
    ticks = ticks + 1;
    const modeName = ledMode === LedMode.Off
      ? 'off'
      : (ledMode === LedMode.Breath ? 'breath' : 'solid');
    UART0.writeLine(`[up] ${ticks * 10}s samples=${stats.count().toFixed(0)} led=${modeName}`);
  }
}

async function consoleTask() {
  let line = '';
  while (true) {
    while (UART0.available() > 0) {
      const b = UART0.read();
      if (b === 13 || b === 10) {                 // CR / LF — submit the line
        UART0.writeLine('');
        dispatch(line);
        line = '';
      } else if (b === 8 || b === 127) {          // BS / DEL — rub out
        if (line.length > 0) {
          line = line.substring(0, line.length - 1);
          UART0.write('\b \b');
        }
      } else if (b >= 32 && b <= 126) {           // printable — accumulate
        const ch = PRINTABLE.charAt(b - 32);
        line = `${line}${ch}`;
        UART0.write(ch);
      }
    }
    await Time.sleep(20);
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
UART0.writeLine('[boot] bench-console ready — type help');
UART0.writeLine(`[boot] ${COMMANDS.length} commands, LED=GPIO2, ADC=GPIO4 @1Hz`);
sampler();
breather();
heartbeat();
consoleTask();
