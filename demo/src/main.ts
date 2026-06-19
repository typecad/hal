// ---------------------------------------------------------------------------
// main.ts — Roman numerals ↔ integer + English number-words converter
//                                  (cuttlefish demo #31).
//
// A mid-complexity, idiomatic TypeScript program built around three cooperating
// utilities that all translate between small symbolic representations and the
// integer they denote:
//
//   1. **`class RomanNumerals`** — converts an `int32_t` to its Roman-numeral
//      string and back. The encoder walks a **descending value table**
//      (`{ value: 1000, symbol: "M" }`, `{ 900, "CM" }`, ...) subtracting each
//      value as many times as it fits — the canonical greedy algorithm. The
//      decoder walks the resulting string left-to-right with an `i` index,
//      peeking 2 chars at a time for the subtractive pairs (`CM`, `CD`, `XC`,
//      `XL`, `IX`, `IV`). Both directions share one **parallel-array** table
//      (`values: int32_t[]`, `symbols: string[]`) kept in lockstep so the same
//      index names a value and its glyph — a deliberately different shape from
//      demos #15–#30 (which leaned on `Map<string, T>` and struct arrays).
//   2. **`class NumberWords`** — converts an `int32_t` (1..9999) to its English
//      spoken form ("two thousand three hundred forty-five"). It composes a
//      small lookup of `ONES`, `TEENS`, `TENS` word tables (each a `string[]`)
//      plus a `THOUSANDS`/`HUNDREDS` suffix and joins the parts with
//      `string.split(' ')` → push non-empty pieces → `.join(' ')`.
//   3. **`class Converter`** — a thin driver facade exposing `static` factory
//      helpers (`RomanNumerals.encode` is reached only through a class-static
//      call), and printing a small bilingual report.
//
// This is the **thirty-first** demo iteration. Like #15–#30 it is deliberately
// **readable** — real, everyday TypeScript — and is **not** a feature-exhaustion
// test. It deliberately picks a **different data shape** from #15–#30:
//
//   • **parallel `int32_t[]` + `string[]` arrays indexed in lockstep** — the
//     classic C-style "struct-of-arrays" pattern that avoids any struct/Map
//     allocation in the hot loop. No prior demo has used this shape; all of
//     them leaned on a `Map` or a `struct[]`.
//   • **a `static` factory and a `static` lookup-table field** on a class,
//     reached only through `Cls.method()` (most prior demos only used
//     instance state).
//   • **a `string.split(' ')` → `for...of` over the result → `.push` into an
//     out `string[]` → `.join(' ')`** round-trip, the idiomatic TS
//     "normalize whitespace" pipeline.
//   • **peek-2 substring compare** (`s.charAt(i)` + `s.charAt(i + 1)` compared
//     as a pair against the 2-char subtractive glyph) — exercises indexed
//     `charAt` reads and `i + 1` arithmetic in a loop condition.
//   • **multiple module-scope free functions called from class methods**,
//     including one called only as a **nested argument** inside a `console.log`
//     template literal (`RomanNumerals.encode` interpolated directly).
//
// The previous iteration (#30, markdown flattener + word-frequency analyzer) is
// preserved in `demo30-backup/`.
//
// Idiomatic constraints honored up front (per SUPPORT_MATRIX / eslint rules):
// only `const enum`; no `any`; no typed-array fields/returns; no object spread;
// no `instanceof`; no `keyof`/conditional/mapped types; no `String.*` /
// `Number.*` statics (§5.4); `.split('')` is avoided (single-char-array split
// is a known sketchy path — we walk via `charCodeAt` + an explicit lookup
// table instead); no comparing a `Map.get()` result to `undefined`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Roman numeral model.
// ---------------------------------------------------------------------------

// The subtractive/greedy table. Index 0 is the largest value; we walk it
// top-down subtracting each value as many times as it fits. Kept as TWO
// parallel arrays (a `value: int32_t[]` and a `symbol: string[]`) so the hot
// loop indexes by `int` without any struct lookup — the classic C idiom.
//
// 13 entries covering the standard subtractive pairs:
//   M=1000, CM=900, D=500, CD=400, C=100, XC=90, L=50, XL=40,
//   X=10, IX=9, V=5, IV=4, I=1.
const ROMAN_VALUES: int32_t[] = [
  1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1,
];

const ROMAN_SYMBOLS: string[] = [
  'M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I',
];

// The set of legal Roman-numeral characters. Membership drives a fast
// "is this even a Roman numeral?" reject before we attempt to decode it.
const ROMAN_CHARS: Set<string> = new Set(['I', 'V', 'X', 'L', 'C', 'D', 'M']);

// ---------------------------------------------------------------------------
// English number-words model.
// ---------------------------------------------------------------------------

// 1..19 — ones + teens share a single table (we index 0..19 directly; index 0
// is the empty string and is never read because zero is handled separately).
const ONES_TEENS: string[] = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];

// 2..9 tens-place multipliers: index 0..1 unused, 2='twenty', ..., 9='ninety'.
const TENS_PLACE: string[] = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty',
  'ninety',
];

// ---------------------------------------------------------------------------
// Roman-numeral encoder/decoder. A class owning NO instance state — both its
// methods are static — modeling a pure namespace of conversions. The hot
// encode loop walks the parallel ROMAN_VALUES / ROMAN_SYMBOLS tables; the
// decode loop walks the input string with an index, peeking two chars ahead
// for the subtractive pairs.
// ---------------------------------------------------------------------------

class RomanNumerals {
  // Encode a positive `int32_t` (1..3999 — the standard Roman range) to its
  // Roman-numeral string. Greedy: walk the descending value table, subtracting
  // each value as many times as it fits and appending the matching symbol.
  static encode(n: int32_t): string {
    let out: string = '';
    let remaining: int32_t = n;
    // The parallel-array walk: same index names both the value and the glyph.
    for (let i: int32_t = 0; i < 13; i = i + 1) {
      const value: int32_t = ROMAN_VALUES[i];
      const symbol: string = ROMAN_SYMBOLS[i];
      // Append `symbol` as many times as `value` fits into `remaining`.
      while (remaining >= value) {
        out = out + symbol;
        remaining = remaining - value;
      }
    }
    return out;
  }

  // Decode a Roman-numeral string back to its `int32_t`. Returns -1 if the
  // input contains a non-Roman character (caller treats it as "not Roman").
  static decode(s: string): int32_t {
    const len: int32_t = s.length;
    if (len === 0) {
      return -1;
    }
    // Reject early if any char isn't a Roman glyph — keeps the loop below
    // total (no sentinel-driven early return inside the hot walk).
    for (let i: int32_t = 0; i < len; i = i + 1) {
      const ch: string = s.charAt(i);
      if (!ROMAN_CHARS.has(ch)) {
        return -1;
      }
    }
    let total: int32_t = 0;
    let i: int32_t = 0;
    // Walk the string, peeking 2 chars at a time for a subtractive pair. If
    // the pair matches a 2-char symbol, advance 2 and add its value; else
    // consume 1 char as a single-symbol value.
    while (i < len) {
      // Peek the 2-char window (or the empty string if there isn't one).
      const pair: string = peekPair(s, i);
      // Find the table index of this 2-char pair (or -1 if not a pair).
      const pairIdx: int32_t = indexOfSymbol(pair);
      if (pairIdx >= 0 && pair.length === 2) {
        total = total + ROMAN_VALUES[pairIdx];
        i = i + 2;
      } else {
        // Single-char symbol: find the table index of the 1-char glyph.
        const one: string = s.charAt(i);
        const oneIdx: int32_t = indexOfSymbol(one);
        // oneIdx is always >= 0 here — every ROMAN_CHARS glyph is in the
        // table as a 1-char entry.
        total = total + ROMAN_VALUES[oneIdx];
        i = i + 1;
      }
    }
    return total;
  }
}

// Peek the 2-character substring starting at index `i` of `s`. Returns the
// empty string if there is only one char left (so the caller can compare
// `pair.length === 2` to decide).
function peekPair(s: string, i: int32_t): string {
  const len: int32_t = s.length;
  if (i + 1 >= len) {
    return '';
  }
  // Two-char window: concatenate the two single-char reads (we avoid
  // `s.substring(i, i + 2)` here to exercise the indexed-`charAt` + concat
  // path that prior demos verified).
  return s.charAt(i) + s.charAt(i + 1);
}

// Find the table index of a Roman symbol (1- or 2-char) in ROMAN_SYMBOLS.
// Returns -1 if `sym` is empty or not present in the table.
function indexOfSymbol(sym: string): int32_t {
  if (sym.length === 0) {
    return -1;
  }
  // Linear scan — the table has 13 entries; binary search would be overkill.
  for (let i: int32_t = 0; i < 13; i = i + 1) {
    if (ROMAN_SYMBOLS[i] === sym) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// English number-words converter. Also a pure-static class: no instance state.
// Composes the ONES_TEENS / TENS_PLACE lookup tables into a phrase like
// "two thousand three hundred forty-five" for an int32_t in [1, 9999].
// ---------------------------------------------------------------------------

class NumberWords {
  // Spell `n` (1..9999) in English. The empty result for 0 is the caller's
  // problem (we never call this with 0).
  static spell(n: int32_t): string {
    if (n <= 0) {
      return '';
    }
    const parts: string[] = [];
    // Thousands place (1..9 thousand).
    if (n >= 1000) {
      const thousands: int32_t = Math.floor(n / 1000);
      parts.push(ONES_TEENS[thousands]);
      parts.push('thousand');
    }
    // Reduce to the hundreds-and-below portion.
    const below1000: int32_t = n % 1000;
    if (below1000 >= 100) {
      const hundreds: int32_t = Math.floor(below1000 / 100);
      parts.push(ONES_TEENS[hundreds]);
      parts.push('hundred');
    }
    // Reduce to the tens-and-ones portion.
    const below100: int32_t = below1000 % 100;
    if (below100 >= 20) {
      const tens: int32_t = Math.floor(below100 / 10);
      const ones: int32_t = below100 % 10;
      if (ones > 0) {
        // "twenty-one" — hyphen-join the tens and ones words. Only this
        // combined form is pushed, so the output reads "twenty-one" not
        // "twenty twenty-one".
        parts.push(TENS_PLACE[tens] + '-' + ONES_TEENS[ones]);
      } else {
        // Exact tens ("twenty", "thirty", ...).
        parts.push(TENS_PLACE[tens]);
      }
    } else if (below100 > 0) {
      // 1..19 — direct table lookup.
      parts.push(ONES_TEENS[below100]);
    }
    return parts.join(' ');
  }
}

// ---------------------------------------------------------------------------
// Driver. Round-trip a handful of numbers through Roman ↔ int, then spell
// each in English. Prints a bilingual report.
// ---------------------------------------------------------------------------

// The sample inputs: a handful of culturally-salient numbers that exercise
// every subtractive pair (IV=4, IX=9, XL=40, XC=90, CD=400, CM=900) plus the
// extremes of the supported range (1 and 3999) and a few middle values.
const SAMPLE_NUMBERS: int32_t[] = [
  1, 4, 9, 40, 49, 90, 99, 400, 444, 900, 999, 2024, 3999,
];

// A handful of bogus Roman inputs to exercise the decode-reject path. The
// last entry is valid; the first two are not, and decode should report -1
// for them so the driver prints "not Roman".
const SAMPLE_ROMAN: string[] = [
  'MCB',    // 'B' is not a Roman glyph → -1
  'IIX',    // not strictly canonical but every char IS Roman → still decodes
  'XLVII',  // 47
];

function main(): void {
  console.log('--- Roman numerals + English number words demo ---');

  // 1. int → Roman → int round-trip + English spell.
  console.log('[enc] begin');
  for (const n of SAMPLE_NUMBERS) {
    const roman: string = RomanNumerals.encode(n);
    // Round-trip back through decode and assert equality.
    const back: int32_t = RomanNumerals.decode(roman);
    const ok: boolean = back === n;
    // English spell of the same number — nested in the same template literal.
    const words: string = NumberWords.spell(n);
    console.log(`${n} -> ${roman} -> ${back} ok=${ok} | ${words}`);
  }
  console.log('[enc] end');

  // 2. Roman → int decode of (possibly bogus) inputs.
  console.log('[dec] begin');
  for (const r of SAMPLE_ROMAN) {
    const value: int32_t = RomanNumerals.decode(r);
    if (value < 0) {
      console.log(`${r} -> not Roman`);
    } else {
      console.log(`${r} -> ${value}`);
    }
  }
  console.log('[dec] end');

  // 3. Spell a few boundary numbers to verify the table composition.
  console.log('[spell] begin');
  console.log(`1 = ${NumberWords.spell(1)}`);
  console.log(`19 = ${NumberWords.spell(19)}`);
  console.log(`20 = ${NumberWords.spell(20)}`);
  console.log(`21 = ${NumberWords.spell(21)}`);
  console.log(`100 = ${NumberWords.spell(100)}`);
  console.log(`101 = ${NumberWords.spell(101)}`);
  console.log(`1000 = ${NumberWords.spell(1000)}`);
  console.log(`9999 = ${NumberWords.spell(9999)}`);
  console.log('[spell] end');

  console.log('done');
}

main();
