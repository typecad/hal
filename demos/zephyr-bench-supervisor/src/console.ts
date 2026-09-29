// ---------------------------------------------------------------------------
// console.ts — pure supervisor logic, no hardware imports.
//
// Exercises the transpiler's collection and text surface: numeric `enum`s +
// switch, a `Record<string, string>` table with dot access, `Map` counters
// with `?? default`, an interface implemented by several command handlers
// dispatched through a `Map<number, CommandHandler>` (virtual calls through
// interface references), a `Uint8Array` histogram, charCode-driven byte
// parsing, and toString(16)/padStart/toFixed formatting.
// ---------------------------------------------------------------------------

export enum Severity {
  Info = 0,
  Warn = 1,
  Fault = 2,
}

export enum Verb {
  None = 0,
  Dump = 1,
  Clear = 2,
  Level = 3,
  Help = 4,
}

export function severityLabel(s: Severity): string {
  switch (s) {
    case Severity.Warn:
      return 'WARN';
    case Severity.Fault:
      return 'FAULT';
    default:
      return 'INFO';
  }
}

/** Anything that can take a report line. Keeps this module hardware-free. */
export interface Sink {
  writeLine(s: string): void;
}

/** One logged event: sequence number, timestamp, severity, fault code. */
export class LogEvent {
  readonly seq: number;
  readonly tMs: number;
  readonly severity: Severity;
  readonly code: number;

  constructor(seq: number, tMs: number, severity: Severity, code: number) {
    this.seq = seq;
    this.tMs = tMs;
    this.severity = severity;
    this.code = code;
  }

  /** `#003 12.3s FAULT code=0x2A` — the on-wire rendering. */
  line(): string {
    const seqPart = `#${this.seq.toFixed(0).padStart(3, '0')}`;
    const secPart = `${(this.tMs / 1000.0).toFixed(1)}s`;
    const codePart = `0x${this.code.toString(16).toUpperCase()}`;
    return `${seqPart} ${secPart} ${severityLabel(this.severity)} code=${codePart}`;
  }
}

/** Fixed-capacity event ring with per-severity counters. */
export class EventLog {
  private readonly _cap: number;
  private readonly _events: LogEvent[];
  private _head: number;
  private _fill: number;
  private _nextSeq: number;
  private readonly _counts: Map<string, number>;

  constructor(cap: number) {
    this._cap = cap;
    this._events = [];
    this._head = 0;
    this._fill = 0;
    this._nextSeq = 1;
    this._counts = new Map<string, number>();
  }

  /** Append an event, recycling the oldest slot once full. */
  record(severity: Severity, code: number, tMs: number): LogEvent {
    const ev = new LogEvent(this._nextSeq, tMs, severity, code);
    this._nextSeq += 1;
    if (this._events.length < this._cap) {
      this._events.push(ev);
      this._fill += 1;
    } else {
      this._events[this._head] = ev;
      this._head = (this._head + 1) % this._cap;
    }
    const key = severityLabel(severity);
    this._counts.set(key, (this._counts.get(key) ?? 0) + 1);
    return ev;
  }

  /** Events currently resident — `at(i)` is valid for i < size. */
  get size(): number {
    return this._fill;
  }

  /** Oldest-first access; i must be < size. */
  at(i: number): LogEvent {
    const idx = this._fill < this._cap ? i : (this._head + i) % this._cap;
    return this._events[idx];
  }

  count(label: string): number {
    return this._counts.get(label) ?? 0;
  }

  clear(): void {
    this._events.length = 0;
    this._head = 0;
    this._fill = 0;
  }
}

/** One rendered histogram bar cell for a bucket of n counts. */
export function barChar(n: number, peak: number): string {
  if (n === peak && n > 0) {
    return '#';
  }
  if (n > 0) {
    return '+';
  }
  return '.';
}

/** 8-bucket histogram over [0, span) — sample distribution at a glance. */
export class Histogram {
  private readonly _buckets: number[];
  private readonly _span: number;
  private _peak: number;

  constructor(span: number) {
    this._buckets = new Array<number>(8);
    this._span = span;
    this._peak = 0;
  }

  add(x: number): void {
    let i = Math.floor((x / this._span) * 8);
    if (i < 0) {
      i = 0;
    }
    if (i > 7) {
      i = 7;
    }
    this._buckets[i] += 1;
    if (this._buckets[i] > this._peak) {
      this._peak = this._buckets[i];
    }
  }

  /** `[.++.#..+]` — one cell per bucket, # marks the peak. */
  bar(): string {
    return (
      `${barChar(this._buckets[0], this._peak)}${barChar(this._buckets[1], this._peak)}` +
      `${barChar(this._buckets[2], this._peak)}${barChar(this._buckets[3], this._peak)}` +
      `${barChar(this._buckets[4], this._peak)}${barChar(this._buckets[5], this._peak)}` +
      `${barChar(this._buckets[6], this._peak)}${barChar(this._buckets[7], this._peak)}`
    );
  }

  get peak(): number {
    return this._peak;
  }
}

/** One parsed console command: verb plus its numeric argument. */
export class Command {
  readonly verb: Verb;
  readonly arg: number;
  readonly ok: boolean;

  constructor(verb: Verb, arg: number, ok: boolean) {
    this.verb = verb;
    this.arg = arg;
    this.ok = ok;
  }
}

// charCodeAt initializers are runtime expressions — the split-mode emitter
// pairs them with a header extern (the prior-extern linkage rule), so the
// inline class bodies below can read them.
const CR = '\r'.charCodeAt(0);
const LF = '\n'.charCodeAt(0);
const BACKSPACE = 8;
const DELETE = 127;
const SPACE = ' '.charCodeAt(0);
const DIGIT0 = '0'.charCodeAt(0);
const MINUS = '-'.charCodeAt(0);
const DOT = '.'.charCodeAt(0);

/** Byte-stream command assembler: feed UART bytes, get parsed commands. */
export class LineAssembler {
  private readonly _buf: number[];
  private readonly _cap: number;

  constructor(cap: number) {
    this._buf = [];
    this._cap = cap;
  }

  /** Feed one received byte; returns a Command when the line terminates. */
  feed(b: number): Command {
    if (b === CR || b === LF) {
      const cmd = this.parse();
      this._buf.length = 0;
      return cmd;
    }
    if (b === BACKSPACE || b === DELETE) {
      this._buf.pop();
      return new Command(Verb.None, 0, false);
    }
    if (this._buf.length < this._cap) {
      this._buf.push(b);
    }
    return new Command(Verb.None, 0, false);
  }

  /** First byte picks the verb; the rest parses as a decimal number. */
  private parse(): Command {
    if (this._buf.length === 0) {
      return new Command(Verb.None, 0, false);
    }
    let verb = Verb.None;
    switch (this._buf[0]) {
      case 68: // 'D'
        verb = Verb.Dump;
        break;
      case 67: // 'C'
        verb = Verb.Clear;
        break;
      case 76: // 'L'
        verb = Verb.Level;
        break;
      case 72: // 'H'
        verb = Verb.Help;
        break;
      default:
        return new Command(Verb.None, this._buf[0], false);
    }

    // Skip blanks, then an optional signed decimal with a fraction part.
    let i = 1;
    while (i < this._buf.length && this._buf[i] === SPACE) {
      i += 1;
    }
    let arg = 0.0;
    let seenDigit = false;
    if (i < this._buf.length && this._buf[i] === MINUS) {
      // Negative levels are not meaningful; treat the sign as a delimiter.
      i += 1;
    }
    let fraction = 0.0;
    let scale = 0.1;
    let whole = true;
    while (i < this._buf.length) {
      const b = this._buf[i];
      if (b === DOT) {
        whole = false;
      } else if (b >= DIGIT0 && b <= DIGIT0 + 9) {
        seenDigit = true;
        if (whole) {
          arg = arg * 10 + (b - DIGIT0);
        } else {
          fraction += (b - DIGIT0) * scale;
          scale /= 10.0;
        }
      }
      i += 1;
    }
    const needsArg = verb === Verb.Level;
    if (needsArg && !seenDigit) {
      return new Command(verb, 0, false);
    }
    return new Command(verb, arg + fraction, true);
  }
}

/** One command verb's behavior. Implementations register themselves under
 *  their Verb in the dispatcher's map. */
export interface CommandHandler {
  verb(): Verb;
  run(arg: number): void;
}

export const HELP: Record<string, string> = {
  dump: 'dump the event log',
  clear: 'clear the event log',
  level: 'set the alarm level in mV',
  help: 'list commands',
};

/** Print every resident event, oldest first. */
export class DumpHandler implements CommandHandler {
  private readonly _log: EventLog;
  private readonly _out: Sink;

  constructor(log: EventLog, out: Sink) {
    this._log = log;
    this._out = out;
  }

  verb(): Verb {
    return Verb.Dump;
  }

  run(arg: number): void {
    this._out.writeLine(`log size=${this._log.size}`);
    for (let i = 0; i < this._log.size; i += 1) {
      this._out.writeLine(this._log.at(i).line());
    }
  }
}

/** Wipe the log; the clear is itself logged by the caller. */
export class ClearHandler implements CommandHandler {
  private readonly _log: EventLog;
  private readonly _out: Sink;

  constructor(log: EventLog, out: Sink) {
    this._log = log;
    this._out = out;
  }

  verb(): Verb {
    return Verb.Clear;
  }

  run(arg: number): void {
    this._log.clear();
    this._out.writeLine('log cleared');
  }
}

/** Adjust the alarm threshold; the level persists in this handler. */
export class LevelHandler implements CommandHandler {
  private _level: number;
  private readonly _out: Sink;

  constructor(level: number, out: Sink) {
    this._level = level;
    this._out = out;
  }

  verb(): Verb {
    return Verb.Level;
  }

  run(arg: number): void {
    this._level = arg;
    this._out.writeLine(`alarm level now ${arg.toFixed(0)}mV`);
  }

  get level(): number {
    return this._level;
  }
}

/** Print the command table. */
export class HelpHandler implements CommandHandler {
  private readonly _out: Sink;

  constructor(out: Sink) {
    this._out = out;
  }

  verb(): Verb {
    return Verb.Help;
  }

  run(arg: number): void {
    this._out.writeLine(`D - ${HELP.dump}`);
    this._out.writeLine(`C - ${HELP.clear}`);
    this._out.writeLine(`L - ${HELP.level}`);
    this._out.writeLine(`H - ${HELP.help}`);
  }
}
