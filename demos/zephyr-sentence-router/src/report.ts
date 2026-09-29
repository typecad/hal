// ---------------------------------------------------------------------------
// report.ts — per-talker aggregation and console formatting.
//
// Exercises: Map<string, number> get/set/size with `??` defaults, optional
// chaining on a Map.get, Math.min/max/round/sqrt, fixed-width bar building
// via string +=, join over a string[], switch on a string enum, and a
// derived ReportLine class whose constructor calls super and overrides a
// method (a second inheritance seam, independent of the Field tree).
// ---------------------------------------------------------------------------

import { Phase, Sentence } from './sentence.js';

/** Fixed-width activity bar: `#####.....`. */
export function bar(n: number, max: number, width: number): string {
  const ratio = max <= 0 ? 0.0 : n / max;
  const filled = Math.min(width, Math.round(ratio * width));
  let s = '';
  for (let i = 0; i < width; i += 1) {
    s += i < filled ? '#' : '.';
  }
  return s;
}

/** Lowercase phase label for the report header. */
export function phaseLabel(p: Phase): string {
  switch (p) {
    case Phase.Sync:
      return 'sync';
    case Phase.Active:
      return 'active';
    case Phase.Alarm:
      return 'ALARM';
    default:
      return 'idle';
  }
}

/** The talker ids this router knows about (Map iteration is not lowered,
 *  so the report sweeps an explicit list). */
export const TALKERS = ['BD', 'GN', 'TC', 'WI'];

/** One rendered report line: base is plain text, sized adds a bar. */
export class ReportLine {
  protected readonly _label: string;
  protected readonly _value: string;

  constructor(label: string, value: string) {
    this._label = label;
    this._value = value;
  }

  text(): string {
    return `${this._label.padEnd(8)} ${this._value}`;
  }
}

/** Report line with a proportional bar appended. */
export class BarLine extends ReportLine {
  private readonly _n: number;
  private readonly _max: number;
  private readonly _width: number;

  constructor(label: string, value: string, n: number, max: number, width: number) {
    super(label, value);
    this._n = n;
    this._max = max;
    this._width = width;
  }

  override text(): string {
    return `${super.text()} [${bar(this._n, this._max, this._width)}]`;
  }
}

/** Per-talker sentence counts + last-seen summaries. */
export class Stats {
  private readonly _counts: Map<string, number>;
  private readonly _last: Map<string, string>;
  private _phase: Phase;

  constructor() {
    this._counts = new Map<string, number>();
    this._last = new Map<string, string>();
    this._phase = Phase.Idle;
  }

  observe(s: Sentence): void {
    this._counts.set(s.talker, (this._counts.get(s.talker) ?? 0) + 1);
    this._last.set(s.talker, s.describe());
    const p = s.phase();
    if (p !== Phase.Idle) {
      this._phase = p;
    }
  }

  count(k: string): number {
    return this._counts.get(k) ?? 0;
  }

  lastOf(k: string): string {
    return this._last.get(k) ?? '(none)';
  }

  /** Total across the known talkers. */
  total(): number {
    let t = 0;
    for (const k of TALKERS) {
      t += this.count(k);
    }
    return t;
  }

  /** Busiest talker id, `--` when nothing arrived. */
  busiest(): string {
    let best = '--';
    let bestN = -1;
    for (const k of TALKERS) {
      const n = this.count(k);
      if (n > bestN) {
        bestN = n;
        best = k;
      }
    }
    return best;
  }

  get phase(): Phase {
    return this._phase;
  }

  /** Renders the whole report as lines (polymorphic text()/join). */
  render(width: number): string {
    const max = Math.max(1, this.total());
    const lines: string[] = [];
    lines.push(new ReportLine('phase', phaseLabel(this._phase)).text());
    lines.push(new ReportLine('busiest', this.busiest()).text());
    for (const k of TALKERS) {
      const n = this.count(k);
      const line = new BarLine(k, this.lastOf(k).slice(0, 12), n, max, width);
      lines.push(line.text());
    }
    return lines.join(' | ');
  }
}
