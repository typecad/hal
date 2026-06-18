// ---------------------------------------------------------------------------
// main.ts — Markdown-to-plaintext renderer + word-frequency analyzer
//                                  (cuttlefish demo #30).
//
// A mid-complexity, idiomatic TypeScript program built around two cooperating
// text-processing utilities that share one line-based model:
//
//   1. **A markdown flattener** — `class Markdown` walks a small, hand-written
//      markdown document line-by-line, classifies each line by a leading
//      marker (`#`, `-`, `*`, `>`, digit+`.`), strips the marker, and emits a
//      plain-text line. Inline emphasis (`*foo*`, `_foo_`) is removed by
//      scanning characters. A `const enum Block` + numeric `switch` is the
//      classifier.
//   2. **A word-frequency analyzer** — `class WordFreq` ingests the flattened
//      text, splits it on whitespace, lowercases each token, drops short stop
//      words against a `Set<string>`, and tallies the survivors in a
//      `Map<string, number>`. The top-N entries are reported via a small
//      selection sort over a `WordCount[]` array of structs.
//
// This is the **thirtieth** demo iteration. Like #15–#29 it is deliberately
// **readable** — real, everyday TypeScript — and is **not** a feature-exhaustion
// test. It deliberately picks a **different data shape** from #15–#29
// (CRUD-over-struct-array, container maps, byte sieve, token stream, min-heap,
// prefix-trie, doubly-linked list, disjoint-set forest, Vigenère cipher,
// Brainfuck interpreter, CRC-32 + INI parser):
//
//   • **chained string methods** — `.split(...)` whose `string[]` result is
//     immediately indexed and then has `.charAt`/`.charCodeAt`/`.slice` called
//     on the *element*, and `.trim().toLowerCase()` chained on a single
//     expression. No prior demo built a long method chain whose intermediate
//     result type the transpiler must resolve by walking the chain rather than
//     a bare identifier.
//   • **`Set<string>` membership filtering** of tokens — `stop.has(word)`
//     drives a keep/drop decision.
//   • **a `Map<string, number>` tally** with `.has`-guarded `.get` +
//     `.set(..., count + 1)` increments.
//   • **a `WordCount[]` struct array** built by `push` and sorted by a
//     hand-rolled selection sort (sort-with-comparator had gaps in demo #12).
//   • a `class` with BOTH a `Map` field AND a `number[]` field, a module-scope
//     free function called from a class method, a `const enum` + numeric
//     `switch`, `for...of` over `string[]`, C-style `for` loops, and template
//     literals interpolating `number`/`string`/`boolean` values.
//
// The previous iteration (#29, CRC-32 + INI parser) is preserved in
// `demo29-backup/`.
//
// Idiomatic constraints honored up front (per SUPPORT_MATRIX / eslint rules):
// only `const enum`; no `any`; no typed-array fields/returns; no object spread;
// no `instanceof`; no `keyof`/conditional/mapped types; no comparing a
// `Map.get()` result to `undefined` (guarded with `.has()`); no mutating an
// array *parameter*; no `delete` on non-Map collections; no `String.*` /
// `Number.*` statics (§5.4).
// ---------------------------------------------------------------------------

// The markdown block classifier. One numeric value per leading-marker family.
const enum Block {
  Heading = 0, // `#`, `##`, ...
  Bullet = 1,  // `-` or `*`
  Quote = 2,   // `>`
  Ordered = 3, // `1.` / `2.` / ...
  Plain = 4,   // anything else (non-empty)
  Blank = 5,   // empty or whitespace only
}

// A tallied word + its count. Emitted as a C++ struct; sorted by count desc.
interface WordCount {
  word: string;
  count: int32_t;
}

// ---------------------------------------------------------------------------
// Markdown flattener. Each non-blank input line is classified by its leading
// marker, the marker is stripped, inline emphasis is removed, and the result
// is appended to an output `string[]`. The class owns its output buffer as a
// field and exposes `render()` to produce a single joined string.
// ---------------------------------------------------------------------------
class Markdown {
  // Output buffer — a `string[]` field mutated by `.push`.
  private lines: string[];

  constructor() {
    this.lines = [];
  }

  // Flatten `source` into plain-text lines appended to this.lines.
  flatten(source: string): void {
    // `string.split('\n')` is the idiomatic TS line tokenizer (demo #29 fix A
    // made a `'\n'` literal argument safe through the standalone renderer).
    const raw: string[] = source.split('\n');
    for (const line of raw) {
      const kind: Block = classifyBlock(line);
      switch (kind) {
        case Block.Blank: {
          // Drop blank lines so the word analyzer doesn't see empty tokens.
          break;
        }
        case Block.Heading: {
          // Strip every leading `#` and one following space.
          const text: string = stripLeading(line, '#').trim();
          this.lines.push(text);
          break;
        }
        case Block.Bullet: {
          // `- item` or `* item` → drop the marker and the space.
          const text: string = line.slice(1).trim();
          this.lines.push(stripEmphasis(text));
          break;
        }
        case Block.Quote: {
          // `> quote` → drop the marker and the space.
          const text: string = line.slice(1).trim();
          this.lines.push(stripEmphasis(text));
          break;
        }
        case Block.Ordered: {
          // `1. text` → drop the digits, the dot, and the space.
          const text: string = stripOrdered(line).trim();
          this.lines.push(stripEmphasis(text));
          break;
        }
        case Block.Plain:
        default: {
          this.lines.push(stripEmphasis(line));
          break;
        }
      }
    }
  }

  // How many lines were flattened.
  size(): int32_t {
    return this.lines.length;
  }

  // The flattened text as one newline-joined string.
  render(): string {
    // `.join` on a NAMED receiver (`this.lines`) is the well-trodden path.
    return this.lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Word-frequency analyzer. Ingests a block of text, splits on whitespace,
// lowercases each token, drops stop words, and tallies survivors in a
// `Map<string, number>`. The top-N entries are reported via a selection sort
// over a `WordCount[]` struct array.
// ---------------------------------------------------------------------------
class WordFreq {
  // Token tallies. `.has`-guarded `.get` + `.set` increments.
  private counts: Map<string, int32_t>;
  // Words seen so far in insertion order — a `string[]` field used so we can
  // iterate the tally without going through `Object.keys`/`Map.keys`.
  private words: string[];

  constructor() {
    this.counts = new Map();
    this.words = [];
  }

  // Ingest `text`, splitting on whitespace, dropping stop words, tallying the
  // rest.
  ingest(text: string, stop: Set<string>): void {
    // Tokenize on whitespace. A regex `/\s+/` split would be the idiomatic JS
    // form, but regex literals are out of scope for the transpiler (§5.4), so
    // we split twice: first on `'\n'` to break lines, then on `' '` to break
    // words within a line. This correctly handles the multi-line flat text
    // (a single-space-only split would fuse the last word of one line with the
    // first word of the next, since `\n` is not `' '`).
    const lines: string[] = text.split('\n');
    for (const line of lines) {
      const tokens: string[] = line.split(' ');
      for (const raw of tokens) {
        // Chained string methods on a `const` loop variable: trim, lowercase.
        // The intermediate result of `.trim()` is itself a `string` whose
        // `.toLowerCase` we then call — the transpiler must resolve the type of
        // the chain, not a bare identifier.
        const cleaned: string = raw.trim().toLowerCase();
        if (cleaned.length === 0) {
          continue;
        }
        if (stop.has(cleaned)) {
          continue;
        }
        if (this.counts.has(cleaned)) {
          const next: int32_t = this.counts.get(cleaned)! + 1;
          this.counts.set(cleaned, next);
        } else {
          this.counts.set(cleaned, 1);
          this.words.push(cleaned);
        }
      }
    }
  }

  // Distinct word count.
  distinct(): int32_t {
    // `.size` on a `Map`-typed `this.field` receiver (demo #29 fix C).
    return this.counts.size;
  }

  // Total occurrences across all distinct words.
  total(): int32_t {
    let sum: int32_t = 0;
    for (const w of this.words) {
      // `.has`-guarded `.get` (comparing a `.get()` result to `undefined` is
      // a build error per SUPPORT_MATRIX §1.5).
      if (this.counts.has(w)) {
        sum = sum + this.counts.get(w)!;
      }
    }
    return sum;
  }

  // The top `n` words by count, descending. Ties break alphabetically. Uses a
  // selection sort over a freshly-built `WordCount[]` struct array.
  top(n: int32_t): WordCount[] {
    const entries: WordCount[] = [];
    for (const w of this.words) {
      if (this.counts.has(w)) {
        const entry: WordCount = { word: w, count: this.counts.get(w)! };
        entries.push(entry);
      }
    }
    // Selection sort: each pass picks the largest remaining element and swaps
    // it into place. Hand-rolled because `Array.sort(comparator)` had lowering
    // gaps in demo #12.
    const len: int32_t = entries.length;
    for (let i: int32_t = 0; i < len; i = i + 1) {
      let best: int32_t = i;
      for (let j: int32_t = i + 1; j < len; j = j + 1) {
        if (compareCounts(entries[j], entries[best]) < 0) {
          best = j;
        }
      }
      if (best !== i) {
        const tmp: WordCount = entries[i];
        entries[i] = entries[best];
        entries[best] = tmp;
      }
    }
    // Return the first `n` (or fewer, if there aren't that many).
    const out: WordCount[] = [];
    const limit: int32_t = Math.min(n, len);
    for (let k: int32_t = 0; k < limit; k = k + 1) {
      out.push(entries[k]);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Markdown classification and stripping helpers. Module-scope free functions
// called from `Markdown.flatten`.
// ---------------------------------------------------------------------------

// Classify a markdown line into a `Block`. Leading whitespace is ignored; the
// first non-space character decides.
function classifyBlock(line: string): Block {
  const trimmed: string = line.trim();
  if (trimmed.length === 0) {
    return Block.Blank;
  }
  const first: string = trimmed.charAt(0);
  if (first === '#') {
    return Block.Heading;
  }
  if (first === '-' || first === '*') {
    return Block.Bullet;
  }
  if (first === '>') {
    return Block.Quote;
  }
  if (isOrderedItem(trimmed)) {
    return Block.Ordered;
  }
  return Block.Plain;
}

// Is `s` an ordered-list item? (`1.` / `23.` / ...)
function isOrderedItem(s: string): boolean {
  const len: int32_t = s.length;
  if (len < 2) {
    return false;
  }
  // Walk leading digits; the first non-digit must be '.' followed by a space
  // or end-of-string.
  let i: int32_t = 0;
  while (i < len) {
    const c: string = s.charAt(i);
    if (!isDigit(c)) {
      break;
    }
    i = i + 1;
  }
  if (i === 0) {
    return false; // no leading digit
  }
  if (i >= len || s.charAt(i) !== '.') {
    return false;
  }
  // Either end-of-string, or a space/whitespace after the dot.
  if (i + 1 === len) {
    return true;
  }
  return s.charAt(i + 1) === ' ';
}

// Is `c` an ASCII digit?
function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

// Strip every leading occurrence of `ch` from `s`.
function stripLeading(s: string, ch: string): string {
  let i: int32_t = 0;
  const len: int32_t = s.length;
  while (i < len && s.charAt(i) === ch) {
    i = i + 1;
  }
  return s.slice(i);
}

// Strip the leading `NNN.` from an ordered-list item. Returns the text after
// the dot (caller trims).
function stripOrdered(s: string): string {
  let i: int32_t = 0;
  const len: int32_t = s.length;
  while (i < len && isDigit(s.charAt(i))) {
    i = i + 1;
  }
  // Skip the dot if present.
  if (i < len && s.charAt(i) === '.') {
    i = i + 1;
  }
  return s.slice(i);
}

// Remove inline emphasis markers (`*foo*` and `_foo_`) by walking the string
// and toggling a "currently inside emphasis" flag at each marker character.
// The output is the plain text with markers removed.
function stripEmphasis(s: string): string {
  let out: string = '';
  const len: int32_t = s.length;
  for (let i: int32_t = 0; i < len; i = i + 1) {
    const c: string = s.charAt(i);
    if (c === '*' || c === '_') {
      // Drop the marker — we don't need to track open/close because both
      // directions just remove the char in plain text.
      continue;
    }
    out = out + c;
  }
  return out;
}

// Compare two `WordCount` entries for the selection sort. Higher count first;
// ties break alphabetically (ascending) for deterministic output.
function compareCounts(a: WordCount, b: WordCount): int32_t {
  if (a.count !== b.count) {
    // Descending by count: larger count sorts earlier.
    return b.count - a.count;
  }
  // Ascending alphabetically on tie.
  return compareStrings(a.word, b.word);
}

// Lexicographic string compare returning -1/0/+1. Hand-rolled because
// `string.localeCompare` is not in the lowered string-method set.
function compareStrings(a: string, b: string): int32_t {
  const la: int32_t = a.length;
  const lb: int32_t = b.length;
  const limit: int32_t = Math.min(la, lb);
  for (let i: int32_t = 0; i < limit; i = i + 1) {
    const ca: int32_t = a.charCodeAt(i);
    const cb: int32_t = b.charCodeAt(i);
    if (ca !== cb) {
      return ca - cb;
    }
  }
  return la - lb;
}

// ---------------------------------------------------------------------------
// Driver. Flatten a small markdown document, then tally its words and report
// the top entries plus a few summary stats.
// ---------------------------------------------------------------------------

// A small, hand-written markdown document. Uses every block kind: a heading,
// bullets, an ordered list, a blockquote, and a plain paragraph with inline
// emphasis. `[...].join('\n')` is the idiomatic TS multi-line-string builder
// (demo #29 fix D made an inline array-literal `__tc_*` receiver typed).
const SAMPLE_MD: string = [
  '# Demo Document',
  '',
  'This is a *short* paragraph with _emphasis_ in it.',
  '',
  '- first bullet point here',
  '- second bullet has words',
  '',
  '1. ordered item one',
  '2. ordered item two',
  '',
  '> a quoted sentence with several words',
  '',
  'Final paragraph wraps up the demo document.',
].join('\n');

// A small stop-word set. These are dropped before tallying so the top-N list
// surfaces content words. `Set<string>` membership drives the keep/drop.
const STOP_WORDS: Set<string> = new Set([
  'a', 'an', 'the', 'in', 'on', 'of', 'to', 'is', 'it', 'with', 'and', 'or',
  'has', 'have', 'here', 'up', 'this', 'that', 'these', 'those',
]);

// Entry point. Flatten the document, tally its words, print the top entries.
function main(): void {
  console.log('--- Markdown + word-frequency demo ---');

  // Flatten markdown → plain text.
  const md: Markdown = new Markdown();
  md.flatten(SAMPLE_MD);
  const flat: string = md.render();
  console.log(`[md] lines    = ${md.size()}`);
  console.log(`[md] chars    = ${flat.length}`);
  console.log('[md] flat     = begin');
  console.log(flat);
  console.log('[md] flat     = end');

  // Tally words. Ingest twice to give some words a count > 1 (demonstrates
  // the `.set(word, count + 1)` increment path).
  const freq: WordFreq = new WordFreq();
  freq.ingest(flat, STOP_WORDS);
  freq.ingest(flat, STOP_WORDS);

  console.log(`[wf] distinct = ${freq.distinct()}`);
  console.log(`[wf] total    = ${freq.total()}`);

  // Top 5 words.
  const top5: WordCount[] = freq.top(5);
  console.log('[wf] top5     = begin');
  for (const entry of top5) {
    console.log(`  ${entry.word} (${entry.count})`);
  }
  console.log('[wf] top5     = end');

  console.log('done');
}

main();
