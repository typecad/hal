// ---------------------------------------------------------------------------
// sentence.ts — pure decoder logic, no hardware imports.
//
// Exercises the transpiler's string/enum/inheritance surface: string-valued
// enums compared, switched on and interpolated; split/slice/substring/
// startsWith/lastIndexOf/trim/toUpperCase/padStart/charCodeAt; parseInt/
// parseFloat; a Field base class with three subclasses dispatched through a
// Field[] (virtual render/kind/weight); super() + super.method(); static
// counters and a static factory returning `Sentence | null`; getters;
// Record<string,string> indexed by a computed key with a `??` default.
// ---------------------------------------------------------------------------

/** Link phases ride the STA sentence as text and are compared here. */
export enum Phase {
  Idle = 'IDLE',
  Sync = 'SYNC',
  Active = 'ACTIVE',
  Alarm = 'ALARM',
}

/** Discriminates the Field subclasses without reflection. */
export enum FieldKind {
  Text = 'TEXT',
  Scaled = 'SCALED',
  Enum = 'ENUM',
}

/** Event-code labels for the EVT sentence. */
export const EVENT_NAMES: Record<string, string> = {
  '0': 'boot',
  '1': 'link-up',
  '2': 'sync',
  '3': 'low-battery',
  '7': 'user-button',
};

// Framing bytes.
const DOLLAR = '$'.charCodeAt(0);
const STAR = '*'.charCodeAt(0);

/** One decoded field: the base renders raw; subclasses specialize. */
export class Field {
  readonly key: string;
  protected readonly _raw: string;
  private static _nextId = 1;
  static allocated = 0;

  constructor(key: string, raw: string) {
    this.key = key;
    this._raw = raw;
    Field._nextId += 1;
    Field.allocated += 1;
  }

  get id(): number {
    return Field._nextId - 1;
  }

  kind(): FieldKind {
    return FieldKind.Text;
  }

  /** Heavier fields draw longer bars in the report. */
  weight(): number {
    return this._raw.length;
  }

  render(): string {
    return this._raw.trim();
  }
}

/** Free-form text field — trimmed and uppercased for the console. */
export class TextField extends Field {
  constructor(key: string, raw: string) {
    super(key, raw);
  }

  override kind(): FieldKind {
    return FieldKind.Text;
  }

  override render(): string {
    const t = super.render();
    return t.length > 0 ? t.toUpperCase() : '?';
  }
}

/** Numeric field scaled into engineering units (raw counts → V or C). */
export class ScaledField extends Field {
  private readonly _scale: number;
  private readonly _offset: number;
  private readonly _unit: string;
  private readonly _value: number;

  constructor(key: string, raw: string, scale: number, offset: number, unit: string) {
    super(key, raw);
    this._scale = scale;
    this._offset = offset;
    this._unit = unit;
    this._value = parseFloat(raw);
  }

  override kind(): FieldKind {
    return FieldKind.Scaled;
  }

  get value(): number {
    return this._value * this._scale + this._offset;
  }

  override weight(): number {
    return Math.round(Math.abs(this.value));
  }

  override render(): string {
    return `${this.value.toFixed(2)}${this._unit}`;
  }
}

/** Event-code field labeled through the EVENT_NAMES table. */
export class EnumField extends Field {
  private readonly _code: number;

  constructor(key: string, raw: string) {
    super(key, raw);
    this._code = parseInt(raw, 10);
  }

  override kind(): FieldKind {
    return FieldKind.Enum;
  }

  override render(): string {
    const label = EVENT_NAMES[`${this._code}`] ?? `code-${this._code.toFixed(0)}`;
    return label;
  }
}

/** One parsed `$TT,KEY,ARGS*CS` sentence. */
export class Sentence {
  readonly talker: string;
  readonly key: string;
  readonly fields: Field[];
  readonly checksumOk: boolean;

  static decoded = 0;
  static rejected = 0;

  constructor(talker: string, key: string, fields: Field[], checksumOk: boolean) {
    this.talker = talker;
    this.key = key;
    this.fields = fields;
    this.checksumOk = checksumOk;
  }

  /** XOR of every byte of the body — the NMEA checksum. */
  static checksumOf(body: string): number {
    let x = 0;
    for (let i = 0; i < body.length; i += 1) {
      x = x ^ body.charCodeAt(i);
    }
    return x & 0xff;
  }

  /** Two uppercase hex digits — the checksum's on-wire form. */
  static hex2(v: number): string {
    return v.toString(16).toUpperCase().padStart(2, '0');
  }

  /** Frame a body the way the generator does — `$` + body + `*` + hex. */
  static frame(body: string): string {
    return `$${body}*${Sentence.hex2(Sentence.checksumOf(body))}`;
  }

  /** Parse one line; null when the framing or checksum fails. */
  static parse(line: string): Sentence | null {
    const t = line.trim();
    if (t.length === 0 || t.charCodeAt(0) !== DOLLAR) {
      Sentence.rejected += 1;
      return null;
    }
    const star = t.lastIndexOf('*');
    if (star < 2) {
      Sentence.rejected += 1;
      return null;
    }
    const body = t.slice(1, star);
    const given = t.substring(star + 1).toUpperCase();
    const want = Sentence.hex2(Sentence.checksumOf(body));
    if (given !== want) {
      Sentence.rejected += 1;
      return null;
    }
    const parts = body.split(',');
    if (parts.length < 2 || parts[0].length < 2) {
      Sentence.rejected += 1;
      return null;
    }
    const talker = parts[0].slice(0, 2).toUpperCase();
    const key = parts[1].toUpperCase();
    const fields: Field[] = [];
    for (let i = 2; i < parts.length; i += 1) {
      fields.push(Sentence.fieldFor(key, i - 2, parts[i]));
    }
    Sentence.decoded += 1;
    return new Sentence(talker, key, fields, true);
  }

  /** Field subclass picked by sentence key + position. */
  static fieldFor(key: string, index: number, raw: string): Field {
    if (raw.length === 0) {
      return new Field(key, raw);
    }
    if (key === 'TMP') {
      return new ScaledField(key, raw, 0.1, 0, 'C');
    }
    if (key === 'BAT') {
      return new ScaledField(key, raw, 0.001, 0, 'V');
    }
    if (key === 'EVT') {
      return new EnumField(key, raw);
    }
    return new TextField(key, raw);
  }

  /** Human summary exercising virtual render over the field array. */
  describe(): string {
    let acc = `${this.talker}/${this.key}`;
    for (const f of this.fields) {
      acc += ` ${f.render()}`;
    }
    return acc;
  }

  /** Phase inferred from a STA text field (default Idle). */
  phase(): Phase {
    for (const f of this.fields) {
      if (f.kind() === FieldKind.Text) {
        const r = f.render();
        if (r === Phase.Sync) { return Phase.Sync; }
        if (r === Phase.Active) { return Phase.Active; }
        if (r === Phase.Alarm) { return Phase.Alarm; }
      }
    }
    return Phase.Idle;
  }

  /** Largest |value| among scaled fields, 0 when none. */
  peak(): number {
    let m = 0;
    for (const f of this.fields) {
      if (f.kind() === FieldKind.Scaled) {
        const w = f.weight();
        if (w > m) {
          m = w;
        }
      }
    }
    return m;
  }

  get fieldCount(): number {
    return this.fields.length;
  }
}
