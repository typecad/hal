// ---------------------------------------------------------------------------
// board-facts.ts — the generated board module as a fact source for hovers.
//
// PURE module: no 'vscode' import, so the monorepo's vitest suite can test
// the parsing and hover-resolution logic directly.
//
// Two generated files feed it:
//   .typecad-hal/board.ts  — pins/aliases/bus instances (facts as JSDoc)
//   .typecad-hal/board.json — the constants map (storage region, hardware
//                             counters, watchdog, console controller)
//
// resolveIdentifierHover answers what a hovered identifier is bound to —
// the user's OWN bindings (`const adc = new ADC(PA0)`), gated HAL classes
// (Store/Counter/…), sensor catalog tokens (SENSOR('bme688')), and — when
// the last engine analysis is available — what the program does with the
// pin. tsserver already covers the board exports themselves; this covers
// what plain TypeScript tooling cannot know.
//
// Same-file bindings only (v1): the declaration must live in the hovered
// document.
// ---------------------------------------------------------------------------

/** A datasheet-named pin (or an alias pointing at one). */
export interface PinFact {
  kind: 'pin';
  /** Datasheet name (PA0, P0.02). */
  name: string;
  /** The harvested-fact doc line from the board module, when present. */
  doc?: string;
}

/** A board-wired bus/controller instance (I2C0, SPI1, UART0, USB0, PWMLED). */
export interface BusFact {
  kind: 'bus';
  label: string;
  doc?: string;
}

export type BoardFact = PinFact | BusFact;

/** Facts read from the generated board.json constants map. */
export interface BoardJsonFacts {
  /** Storage region backing Store/File, when the board has one. */
  storage?: { offsetBytes: number; sizeBytes: number; preexisting: boolean };
  /** Free hardware counter node labels (kernel-claimed ones excluded upstream). */
  counters: string[];
  /** The watchdog devicetree node label, when wired. */
  watchdog?: string;
  /** The board's chosen console controller. */
  console?: string;
}

export interface BoardFacts {
  /** export name → fact (pins, aliases, bus instances). */
  readonly exports: Map<string, BoardFact>;
  /** Hardware classes this board's module re-exports (the gate list). */
  readonly classExports: ReadonlySet<string>;
  /** Facts from board.json, when it was parsed alongside the module. */
  readonly boardInfo?: BoardJsonFacts;
}

/** What to show for a hovered identifier. */
export interface HoverInfo {
  /** Bold first line, e.g. "ADC — on PA0". */
  title: string;
  /** Fact lines beneath (one per line, markdown). */
  detail?: string;
}

/** Structural slice of @typecad/hal's SensorPartInfo (loaded from the project). */
export interface SensorPartInfoLike {
  compatible: string;
  buses: readonly string[];
  description: string;
  channels: readonly string[];
}

/** Live-program context threaded into hover resolution. */
export interface HoverContext {
  /** GPIO claims from the last engine analysis (board facts + program facts). */
  programPinUsage?: ReadonlyArray<{ pinName: string; mode: string; peripheralRole?: string }>;
  /** The sensor part catalog from the project's @typecad/hal copy. */
  sensors?: Readonly<Record<string, SensorPartInfoLike>>;
}

const PIN_DECL =
  /(?:^|\n)(?:\/\*\*([^\n]*)\*\/\n)?export const ([A-Za-z_$][\w$]*) = Pin\.fromPort\('([^']+)'\);/g;
const ALIAS_DECL =
  /(?:^|\n)(?:\/\*\*([^\n]*)\*\/\n)?export const ([A-Za-z_$][\w$]*) = ([A-Za-z_$][\w$]*);/g;
const BUS_DECL =
  /(?:^|\n)(?:\/\*\*([^\n]*)\*\/\n)?export const ([A-Za-z_$][\w$]*) = new (I2CBus|SPIBus|UART|USBConsole|PWM)\(/g;
const GATED_DECL = /export \{([^}]+)\} from '@typecad\/hal\/core';/g;

/**
 * Parse a generated board module into its fact map. Aliases resolve to the
 * target pin's fact (transitively, depth-capped); a bare alias with no
 * resolvable target is skipped rather than guessed.
 */
export function parseBoardModule(text: string, boardJsonText?: string): BoardFacts {
  const map = new Map<string, BoardFact>();

  for (const m of text.matchAll(PIN_DECL)) {
    const doc = m[1]?.trim() || undefined;
    map.set(m[2]!, { kind: 'pin', name: m[3]!, ...(doc ? { doc } : {}) });
  }
  for (const m of text.matchAll(BUS_DECL)) {
    const doc = m[1]?.trim() || undefined;
    map.set(m[2]!, { kind: 'bus', label: m[2]!, ...(doc ? { doc } : {}) });
  }
  // Aliases last (they reference the pins above); resolve transitively.
  const aliasTargets = new Map<string, string>();
  for (const m of text.matchAll(ALIAS_DECL)) {
    if (map.has(m[2]!)) continue; // already a pin/bus export
    aliasTargets.set(m[2]!, m[3]!);
  }
  for (const [alias, target] of aliasTargets) {
    let hop: string | undefined = target;
    for (let depth = 0; depth < 3 && hop !== undefined; depth++) {
      const fact = map.get(hop);
      if (fact?.kind === 'pin') {
        map.set(alias, fact);
        break;
      }
      hop = aliasTargets.get(hop);
    }
  }

  // The gated-class re-export lines carry the board's hardware gate list.
  const classExports = new Set<string>();
  for (const m of text.matchAll(GATED_DECL)) {
    for (const name of m[1]!.split(',')) {
      const ident = name.trim();
      if (ident) classExports.add(ident);
    }
  }

  const boardInfo = boardJsonText !== undefined ? parseBoardJson(boardJsonText) : undefined;
  return { exports: map, classExports, ...(boardInfo ? { boardInfo } : {}) };
}

/** Pull the hover-relevant facts out of a generated board.json manifest. */
export function parseBoardJson(text: string): BoardJsonFacts {
  let constants: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text) as { constants?: Record<string, unknown> };
    if (parsed.constants && typeof parsed.constants === 'object') constants = parsed.constants;
  } catch {
    return { counters: [] };
  }
  const num = (key: string): number | undefined => {
    const v = constants[key];
    return typeof v === 'number' ? v : undefined;
  };
  const storageOffset = num('zephyr.storage.offset');
  const storageSize = num('zephyr.storage.size');
  const counters: string[] = [];
  for (let i = 0; ; i++) {
    const label = constants[`zephyr.hwtimer.controllers.${i}.nodeLabel`];
    if (typeof label !== 'string') break;
    counters.push(label);
  }
  const wdt = constants['zephyr.wdt.nodeLabel'];
  const consoleLabel = constants['zephyr.console'];
  return {
    ...(storageOffset !== undefined && storageSize !== undefined
      ? { storage: { offsetBytes: storageOffset, sizeBytes: storageSize, preexisting: constants['zephyr.storage.preexisting'] === true } }
      : {}),
    counters,
    ...(typeof wdt === 'string' ? { watchdog: wdt } : {}),
    ...(typeof consoleLabel === 'string' ? { console: consoleLabel } : {}),
  };
}

/**
 * Resolve what `identifier` (a variable in `documentText`) is bound to and
 * produce hover content from the board facts. Returns undefined when the
 * binding carries no hardware fact — tsserver's own hover then stands.
 */
export function resolveIdentifierHover(
  documentText: string,
  facts: BoardFacts,
  identifier: string,
  context: HoverContext = {},
): HoverInfo | undefined {
  // Sensor catalog tokens: hovering the part key inside SENSOR('bme688').
  const sensor = context.sensors?.[identifier];
  if (sensor) {
    const lines = [
      // Some generated bindings carry a placeholder ('|') description.
      ...(/^[|]*$/.test(sensor.description.trim()) ? [] : [sensor.description]),
      `${sensor.compatible} · bus ${sensor.buses.join('/')}`,
      ...(sensor.channels.length > 0 ? [`channels: ${sensor.channels.join(', ')}`] : []),
    ];
    return { title: `SENSOR('${identifier}')`, detail: lines.join('\n') };
  }

  // Gated hardware classes: facts the board module knows but the re-export
  // line cannot carry as JSDoc (storage region, counters, watchdog node).
  if (facts.classExports.has(identifier)) {
    const classHover = classFactHover(identifier, facts);
    if (classHover) return classHover;
  }

  // Direct board pin export used by the program: append the program's claim
  // alongside tsserver's static-fact hover (VS Code merges providers).
  const direct = facts.exports.get(identifier);
  if (direct?.kind === 'pin') {
    const usage = usageFor(direct.name, identifier, context);
    if (usage) return { title: `In this project`, detail: usage };
    return undefined;
  }

  // The identifier's declaration in THIS document: const/let/var name = init.
  // Single-line initializers; the trailing semicolon is optional (the demo
  // and scaffold style omits it).
  const decl = new RegExp(
    `(?:^|\\n)\\s*(?:const|let|var)\\s+${escapeRe(identifier)}\\s*(?::[^=\\n]+)?=\\s*([^;\\n]+);?`,
  ).exec(documentText);
  if (!decl) return undefined;
  const init = decl[1]!.trim();

  // 1. Direct pin alias: `const s = PA0;` / `const led = LED;`
  if (/^[A-Za-z_$][\w$]*$/.test(init)) {
    const fact = facts.exports.get(init);
    if (fact?.kind === 'pin') {
      const usage = usageFor(fact.name, init, context);
      return {
        title: `${fact.name} — pin alias of ${init}`,
        detail: [fact.doc, usage].filter((l): l is string => !!l).join('\n') || undefined,
      };
    }
    return undefined;
  }

  // 2. Peripheral construction: `const adc = new ADC(PA0);`
  const construct = /^new\s+([A-Za-z_$][\w$]*)\s*\((.*)\)$/.exec(init);
  if (construct) {
    const className = construct[1]!;
    const pinArgs = splitArgs(construct[2]!)
      .map((arg) => facts.exports.get(arg))
      .filter((f): f is PinFact => f?.kind === 'pin');
    if (pinArgs.length === 0) return undefined;
    const names = pinArgs.map((p) => p.name).join(', ');
    const lines = pinArgs.flatMap((p) => [p.doc, usageFor(p.name, '', context)].filter((l): l is string => !!l));
    return {
      title: `${className} — on ${names}`,
      ...(lines.length > 0 ? { detail: lines.join('\n') } : {}),
    };
  }

  // 3. Device on a board bus: `const therm = I2C0.device(0x48);`
  const memberCall = /^([A-Za-z_$][\w$]*)\s*\.\s*[A-Za-z_$][\w$]*\s*\(/.exec(init);
  if (memberCall) {
    const bus = facts.exports.get(memberCall[1]!);
    if (bus?.kind === 'bus') {
      return {
        title: `${bus.label} — board bus`,
        ...(bus.doc ? { detail: bus.doc } : {}),
      };
    }
  }

  return undefined;
}

// -- helpers -------------------------------------------------------------------

/** Facts for the gated classes whose wiring lives in board.json. */
function classFactHover(identifier: string, facts: BoardFacts): HoverInfo | undefined {
  const info = facts.boardInfo;
  if (identifier === 'Store' || identifier === 'File') {
    const storage = info?.storage;
    if (!storage) return undefined;
    const origin = storage.preexisting ? "the board's own storage partition" : 'a region synthesized at flash top';
    return {
      title: `${identifier} — persistent storage`,
      detail: `${formatBytes(storage.sizeBytes)} at flash offset 0x${storage.offsetBytes.toString(16)} (${origin})`,
    };
  }
  if (identifier === 'Counter') {
    if (!info || info.counters.length === 0) return undefined;
    return {
      title: 'Counter — hardware counters',
      detail: `${info.counters.length} free: ${info.counters.join(', ')}`,
    };
  }
  if (identifier === 'Watchdog') {
    if (!info?.watchdog) return undefined;
    return { title: 'Watchdog', detail: 'Wired on this board — resets the board on timeout unless fed.' };
  }
  return undefined;
}

/** The program's claim on a pin, from the last analysis ("input · button"). */
function usageFor(
  pinName: string,
  identifier: string,
  context: HoverContext,
): string | undefined {
  const usage = context.programPinUsage?.find(
    (u) => u.pinName === pinName || u.pinName === identifier,
  );
  if (!usage) return undefined;
  return `In this project: ${usage.mode}${usage.peripheralRole ? ` (${usage.peripheralRole})` : ''}`;
}

/** Split a top-level argument list on commas (nested parens/braces stay whole). */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of args) {
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// -- inline decorations --------------------------------------------------------
//
// After-line fact chips on construction lines: what the line's pin can do
// that the code does not say. Pure — the provider glue in extension.ts maps
// these onto editor decorations.

/** One inline decoration: a fact chip rendered after line `line` (0-based). */
export interface DecorationSpec {
  line: number;
  text: string;
}

const CHIP_PREFIX = '⌁ ';

/**
 * Scan a document for lines that deserve a fact chip: pin constructions
 * (`new ADC(PA0)`) and board-bus device calls (`I2C0.device(0x44)`). A
 * construction chip names the argument's RESOLVED datasheet pin first —
 * `new GPIO(LED, …)` renders `⌁ PC13` — followed by the pin's facts minus
 * the alias that just echoes the written identifier. A line only gets a
 * chip when there is something to add: a fact, or a pin name the code did
 * not spell (an alias). Comment lines are skipped.
 */
export function scanDecorations(text: string, facts: BoardFacts, maxLen = 72): DecorationSpec[] {
  const out: DecorationSpec[] = [];
  const lines = text.split('\n');
  let lineStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      // Construction: each board-pin argument contributes its resolved name
      // plus its facts (self-echoing alias stripped).
      const construct = /new\s+[A-Za-z_$][\w$]*\s*\(([^)\n]*)\)/.exec(line);
      if (construct && isCodePosition(text, lineStart + construct.index)) {
        const parts: string[] = [];
        for (const arg of splitArgs(construct[1]!)) {
          const fact = facts.exports.get(arg);
          if (fact?.kind !== 'pin') continue;
          const doc = fact.doc ? docWithoutSelfAlias(fact.doc, arg) : undefined;
          if (doc || arg !== fact.name) parts.push([fact.name, doc].filter(Boolean).join(' · '));
        }
        if (parts.length > 0) {
          out.push({ line: i, text: chip(parts.join(' · '), maxLen) });
          lineStart += line.length + 1;
          continue;
        }
      }

      // Board-bus device call: the bus's wiring doc (controller + pad map).
      // The object identifier may sit anywhere in the line (`const t = I2C1.device(…)`).
      const busCall = /(?:^|[=(\s])([A-Za-z_$][\w$]*)\s*\.\s*device\s*\(/.exec(line);
      if (busCall && isCodePosition(text, lineStart + busCall.index)) {
        const bus = facts.exports.get(busCall[1]!);
        if (bus?.kind === 'bus' && bus.doc) {
          out.push({ line: i, text: chip(bus.doc, maxLen) });
        }
      }
    }
    lineStart += line.length + 1;
  }
  return out;
}

/** The pin's fact doc with the aliases segment minus the alias `self` —
 *  `aliases: LED` written as LED need not be told LED is an alias. */
function docWithoutSelfAlias(doc: string, self: string): string | undefined {
  const parts = doc.split(' · ').flatMap((p) => {
    if (!p.startsWith('aliases: ')) return [p];
    const names = p.slice('aliases: '.length).split(', ').filter((n) => n !== self);
    return names.length > 0 ? [`aliases: ${names.join(', ')}`] : [];
  });
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function chip(text: string, maxLen: number): string {
  const body = text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
  return `${CHIP_PREFIX}${body}`;
}

// -- lexical position classification -------------------------------------------
//
// The hover/decoration scans are plain text searches, but a word inside a
// string literal, a template's literal part, or a comment is TEXT, not an
// identifier — `USB0.writeLine(\`adc: ${adc.read()}\`)` has two "adc" words
// and only the one inside ${} is the variable. isCodePosition answers that
// with a small state-stack lexer (templates nest: `${\`…${…}…\`}` keeps the
// inner interpolation code). One consumer deliberately ignores it: sensor
// tokens (`SENSOR('bme688')`) live inside quotes by design.

/**
 * Whether the character at `offset` is real code — not string text, not a
 * template literal's literal part, not a comment. O(text) per call.
 */
export function isCodePosition(text: string, offset: number): boolean {
  type Frame = { kind: 'code'; depth: number } | { kind: 'tpl' } | { kind: 'str'; q: string };
  const stack: Frame[] = [{ kind: 'code', depth: 0 }];
  let comment: '' | 'line' | 'block' = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const next = i + 1 < text.length ? text[i + 1]! : '';

    if (comment === 'line') {
      if (i === offset) return false;
      if (c === '\n') comment = '';
      continue;
    }
    if (comment === 'block') {
      if (i === offset) return false;
      if (c === '*' && next === '/') {
        comment = '';
        i++;
      }
      continue;
    }

    const top = stack[stack.length - 1]!;
    if (i === offset) return top.kind === 'code';

    if (top.kind === 'str') {
      if (c === '\\') i++;
      else if (c === top.q) stack.pop();
      continue;
    }
    if (top.kind === 'tpl') {
      if (c === '\\') i++;
      else if (c === '`') stack.pop();
      else if (c === '$' && next === '{') {
        stack.push({ kind: 'code', depth: 0 });
        i++;
      }
      continue;
    }
    // top.kind === 'code'
    if (c === '/' && next === '/') {
      comment = 'line';
      i++;
    } else if (c === '/' && next === '*') {
      comment = 'block';
      i++;
    } else if (c === '"' || c === "'") {
      stack.push({ kind: 'str', q: c });
    } else if (c === '`') {
      stack.push({ kind: 'tpl' });
    } else if (c === '{') {
      top.depth++;
    } else if (c === '}') {
      if (top.depth > 0) top.depth--;
      else if (stack.length > 1) stack.pop(); // closes a ${ interpolation → back to its template
    }
  }
  return false;
}
