// ---------------------------------------------------------------------------
// proto.ts — the $CMD,field,...*CS sentence protocol, pure logic.
//
// Round-3 stress surface for the one-string model: split/join round trips,
// charCodeAt XOR checksums over a for-of string loop, compound bitwise
// assignment, toString(16)/padStart/toUpperCase formatting, Map<string,string>
// with get ?? default, delete, and destructured iteration, Number.parseInt
// static forms, native += accumulation, an interface with two implementations
// dispatched through a base reference, and a static counter.
// ---------------------------------------------------------------------------

export enum CmdKind {
  Set = 0,
  Get = 1,
  List = 2,
  Clear = 3,
  Unknown = 4,
}

export function cmdName(k: CmdKind): string {
  switch (k) {
    case CmdKind.Set:
      return 'SET';
    case CmdKind.Get:
      return 'GET';
    case CmdKind.List:
      return 'LST';
    case CmdKind.Clear:
      return 'CLR';
    default:
      return 'UNK';
  }
}

/** XOR checksum over the sentence text between '$' and '*' — the NMEA rule. */
export function checksum(s: string): number {
  let cs = 0;
  for (const ch of s) {
    cs ^= ch.charCodeAt(0);
  }
  return cs & 0xff;
}

/** 42 → "2A" — the two-hex-digit form every sentence carries. */
export function hex2(v: number): string {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

/** Parse "2A" → 42 (-1 when the text is not two hex digits). */
export function parseHex2(text: string): number {
  const t = text.trim();
  if (t.length !== 2) {
    return -1;
  }
  const v = Number.parseInt(t, 16);
  return Number.isNaN(v) ? -1 : v;
}

/** Build `$SET,gain,1.5*CS` from parts — join + checksum + hex formatting. */
export function buildSentence(parts: string[]): string {
  const body = parts.join(',');
  return `$${body}*${hex2(checksum(body))}`;
}

/** One parsed inbound sentence. */
export class Sentence {
  readonly valid: boolean;
  readonly kind: CmdKind;
  readonly fields: string[];

  constructor(raw: string) {
    const line = raw.trim();
    this.valid = false;
    this.kind = CmdKind.Unknown;
    this.fields = [];
    if (!line.startsWith('$') || !line.includes('*')) {
      return;
    }
    const body = line.substring(1, line.indexOf('*'));
    const csText = line.substring(line.indexOf('*') + 1);
    const want = parseHex2(csText);
    if (want < 0 || want !== checksum(body)) {
      return;
    }
    this.fields = body.split(',');
    if (this.fields.length === 0) {
      return;
    }
    const head = this.fields[0].trim().toUpperCase();
    if (head === 'SET') {
      this.kind = CmdKind.Set;
    } else if (head === 'GET') {
      this.kind = CmdKind.Get;
    } else if (head === 'LST') {
      this.kind = CmdKind.List;
    } else if (head === 'CLR') {
      this.kind = CmdKind.Clear;
    } else {
      return;
    }
    this.valid = true;
  }
}

/** How replies render — terse single line or verbose with echo. */
export interface ReplyFormatter {
  ok(key: string, value: string): string;
  err(why: string): string;
}

export class TerseFormatter implements ReplyFormatter {
  ok(key: string, value: string): string {
    return buildSentence(['OK', key, value]);
  }

  err(why: string): string {
    return buildSentence(['ERR', why]);
  }
}

export class VerboseFormatter implements ReplyFormatter {
  ok(key: string, value: string): string {
    return buildSentence(['OK', key, value, 'acked']);
  }

  err(why: string): string {
    return buildSentence(['ERR', why, 'try:LST']);
  }
}

/** Key/value settings with file-shaped (de)serialization. */
export class Settings {
  private readonly _map: Map<string, string>;
  static ops: number = 0;

  constructor() {
    this._map = new Map<string, string>();
  }

  get(key: string): string {
    return this._map.get(key) ?? '';
  }

  set(key: string, value: string): void {
    this._map.set(key, value);
    Settings.ops += 1;
  }

  remove(key: string): boolean {
    return this._map.delete(key);
  }

  get size(): number {
    return this._map.size;
  }

  /** "k=v" per resident key — the wire form for LST and serialize(). */
  pairs(): string[] {
    const out: string[] = [];
    for (const [k, v] of this._map) {
      out.push(`${k}=${v}`);
    }
    out.sort();
    return out;
  }

  /** "gain=1.5\nrate=10" — sorted so the file diffs cleanly. */
  serialize(): string {
    const pairs = this.pairs();
    let out = '';
    for (const p of pairs) {
      out += p;
      out += '\n';
    }
    return out;
  }

  /** Load a serialize()d blob; returns the count of keys accepted. */
  load(text: string): number {
    let n = 0;
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t.length === 0 || !t.includes('=')) {
        continue;
      }
      const eq = t.indexOf('=');
      const k = t.substring(0, eq).trim();
      const v = t.substring(eq + 1).trim();
      if (k.length > 0) {
        this._map.set(k, v);
        n += 1;
      }
    }
    return n;
  }

  /** True when two settings agree on every shared key (subset compare). */
  agreesWith(other: Settings, key: string): boolean {
    return this.get(key) === other.get(key);
  }
}

/** Apply a sentence to settings; returns the reply parts (no formatting). */
export function applySentence(cfg: Settings, s: Sentence): { ok: boolean; key: string; value: string; why: string } {
  if (s.kind === CmdKind.Set) {
    if (s.fields.length < 3) {
      return { ok: false, key: '', value: '', why: 'SET,want:key,value' };
    }
    const key = s.fields[1].trim();
    if (key.length === 0) {
      return { ok: false, key: '', value: '', why: 'empty-key' };
    }
    // (fields.slice(2).join('=') — an ambiguous slice on a class vector
    // field currently mangles the dispatch; explicit loop until fixed.)
    let value = '';
    for (let i = 2; i < s.fields.length; i += 1) {
      value = i > 2 ? `${value}=${s.fields[i]}` : s.fields[i];
    }
    cfg.set(key, value);
    return { ok: true, key, value, why: '' };
  }
  if (s.kind === CmdKind.Get) {
    if (s.fields.length < 2) {
      return { ok: false, key: '', value: '', why: 'GET,want:key' };
    }
    const key = s.fields[1].trim();
    const value = cfg.get(key);
    if (value.length === 0) {
      return { ok: false, key, value, why: 'no-key' };
    }
    return { ok: true, key, value, why: '' };
  }
  if (s.kind === CmdKind.Clear) {
    if (s.fields.length < 2) {
      return { ok: false, key: '', value: '', why: 'CLR,want:key' };
    }
    const key = s.fields[1].trim();
    return { ok: cfg.remove(key), key, value: '', why: 'no-key' };
  }
  return { ok: false, key: '', value: '', why: cmdName(s.kind) + '?' };
}
