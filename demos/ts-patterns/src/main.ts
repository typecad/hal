// ---------------------------------------------------------------------------
// main.ts — TypeScript pattern gallery (single entry, console sections).
//
// One deterministic program exercising the common idiomatic TypeScript
// patterns, printed over the board's UART0 console through the one-line
// `report` seam (report.ts). Section order and every printed value are
// fixed, so the SAME source doubles as a differential-execution case:
// tests/packages/cuttlefish/ts-patterns-gallery.test.ts runs it under Node
// (the JS-semantics oracle) and as transpiled→host-g++→native and requires
// identical stdout.
//
// Sections: variables · functions · objects · arrays · classes · control
// flow. Non-integer values print through toFixed() — raw double
// interpolation renders differently per target, and matching output is
// part of what the gallery asserts.
//
// Locals are UNIQUE ACROSS THE FILE on purpose: the emitter's type maps
// are keyed by bare name at file scope, so same-named locals in different
// functions poison each other's lowering (see README findings).
//
// Patterns the current tree cannot lower are deliberately ABSENT (each is
// an engine finding in demos/ts-patterns/README.md): object literals bound
// to interface-typed variables or passed as interface-typed arguments,
// setters, generic classes instantiated with explicit primitive type
// arguments, IIFEs, keyof, instanceof on user hierarchies, typeof
// narrowing over union parameters, optional-field nullish access, object
// spread, dynamic string-keyed access, string truthiness, Array.slice,
// sort/join/Map.keys (explicit-loop idioms are used instead), multi-arg
// push, stateful closures, function-typed arrays, and cross-module aliased
// imports (the program must be a single user TU — the callback-promotion
// pass scatters statements across translation units otherwise).
// ---------------------------------------------------------------------------

import { report } from './report';


// ═══════════════════════════════ 01 · VARIABLES ════════════════════════════
// var/let/const + scope and shadowing, annotations and inference, literal
// forms (hex/binary/octal/exponent, escapes, template literals), literal
// unions, type aliases, enums (numeric and string), tuples and typed
// arrays, destructuring (array/object/nested/defaults/rename + rest and
// swap), spread, optional chaining and nullish coalescing, compound
// assignment, ++/--, the bitwise family.

type PinState = 'input' | 'output';

enum Level {
  Low,
  Medium,
  High,
}

enum Label {
  Off = 'OFF',
  On = 'ON',
}

function shadowing(): number {
  let mutable = 100; // shadows the caller's `mutable`
  return mutable + 3;
}

// `??` and `?.` lower per-target on nullable locals/parameters; object
// chains that end in a FIELD use an explicit null check, because optional
// struct/interface fields flatten in C++ (TS2CPP_OPTIONAL_FIELD_NULLISH).
function nickname(s: string): string {
  // ?? on a plain string local (the null-flow form crashes the native
  // runtime: std::string cannot construct from null)
  const up = s.length > 0 ? s.toUpperCase() : '';
  return up ?? 'anon';
}

function truthyLabel(s: string): string {
  // string truthiness (`s ? ... : ...`) does not lower — use an explicit
  // emptiness check
  return s.length > 0 ? 'yes' : 'no';
}

function sectionVariables(): void {
  // ── var / let / const ────────────────────────────────────────────────────
  var legacy = 1;
  let mutable = 2;
  const frozen = 3;
  legacy = legacy + 10;
  mutable = mutable + 20;

  // ── numeric literal forms ────────────────────────────────────────────────
  const hex = 0xff; // 255
  const binary = 0b1010; // 10
  const octal = 0o17; // 15
  const exponent = 2.5e3; // 2500

  // ── string literal forms ─────────────────────────────────────────────────
  const single = 'single';
  const escaped: string = 'tab\there\nnewline "quoted" back\\slash';
  const greeting = `hello ${single}`;
  const multiline = `line1
line2`;
  const innerPart = `inner ${1 + 1}`;
  const nested = `outer ${innerPart} end`;

  // ── literal unions ───────────────────────────────────────────────────────
  let state: PinState = 'input';
  state = 'output';

  // ── tuples and typed arrays ─────────────────────────────────────────────
  // Heterogeneous tuples lower to std::tuple with std::get<N> access.
  const pair: [number, number] = [7, 8];
  const baud: [number, string] = [9600, 'baud'];
  const readings: number[] = [10, 20, 30];
  const names: string[] = ['ada', 'grace'];

  // ── destructuring ────────────────────────────────────────────────────────
  const point = { x: 3, y: 4, z: 5 };
  const { x, y, z = 99 } = point; // object, with default
  const { x: px, y: py } = point; // renamed
  const nestedSrc = { outer: { inner: 41 }, tag: 'deep' };
  const { outer: { inner }, tag } = nestedSrc; // nested
  const [firstReading, ...restReadings] = readings; // array + rest
  let swapA = 1;
  let swapB = 2;
  [swapA, swapB] = [swapB, swapA]; // swap via destructuring
  const combined = [...names, 'kay']; // array spread

  // ── optional chaining + nullish coalescing ───────────────────────────────
  const maybe = { owner: { name: 'nn' }, value: 0 };
  const absent = '';
  const chosen = absent ?? 'fallback';

  // ── compound assignment / increments ────────────────────────────────────
  let acc = 10;
  acc += 5;
  acc -= 3;
  acc *= 2;
  acc /= 3; // 8
  acc %= 5; // 3
  const pre = ++acc; // 4
  const post = acc++; // 4, acc now 5
  acc **= 2; // 25
  let flags = 0b1100;
  flags &= 0b1010;
  flags |= 0b0001;
  flags ^= 0b0010;

  report(`V01 vars: legacy=${legacy} mutable=${mutable} frozen=${frozen} shadow=${shadowing()}`);
  report(`V02 literals: hex=${hex} bin=${binary} oct=${octal} exp=${exponent}`);
  report(`V03 strings: g=${greeting} esc=${escaped}`);
  report(`V04 templates: nested=${nested} lines=${multiline.length}`);
  report(`V05 unions: state=${state} swapped=${state === 'output' ? 'yes' : 'no'}`);
  report(`V06 enums: level=${Level.Medium} label=${Label.On}`);
  report(`V07 arrays: readings0=${readings[0]} readings2=${readings[2]} names1=${names[1]}`);
  report(`V07b tuples: pair=${pair[0]}/${pair[1]} baud=${baud[0]} mode=${baud[1]}`);
  report(`V08 destructure: x=${x} y=${y} z=${z} px=${px} py=${py}`);
  report(`V09 destructure: inner=${inner} tag=${tag} first=${firstReading} rest=${restReadings.length}`);
  report(`V10 swap: a=${swapA} b=${swapB} combined=${combined.length}`);
  report(`V11 nullish: nick=${nickname('jo')} chosen=${chosen}`);
  report(`V12 assign: acc=${acc} pre=${pre} post=${post}`);
  report(`V13 bitwise: flags=${flags} shift=${4 << 2} ushift=${16 >>> 2}`);
  report(`V14 chains: owner=${maybe.owner.name} truthy=${truthyLabel('x')} truthy=${truthyLabel('')}`);
}



// ═══════════════════════════════ 02 · FUNCTIONS ════════════════════════════
// declarations / expressions / named function expressions, concise and
// block arrows, default / optional / rest parameters, parameter
// destructuring, function type aliases, typed callbacks, higher-order
// functions, closures (factories over parameters, forEach folds over
// captured locals), recursion (direct + mutual), generic functions with
// constraints, void functions, early returns, optional calls (cb?.()).
// IIFEs are not supported (the body is not inlined) — the idiom is a
// const-bound lambda.

function add(a: number, b: number): number {
  return a + b;
}

const subtract = (a: number, b: number): number => a - b;

const multiply = (a: number, b: number): number => a * b; // concise arrow

const divide = (a: number, b: number): number => { // block arrow
  if (b === 0) {
    return 0;
  }
  return a / b;
};

// Named function expressions don't render — const-bound arrows are the
// supported function-object form.
const clamp = (n: number, lo: number, hi: number): number => {
  if (n < lo) {
    return lo;
  }
  if (n > hi) {
    return hi;
  }
  return n;
};

// ── parameter patterns ─────────────────────────────────────────────────────
function greet(name: string, greeting: string = 'hello'): string {
  return `${greeting}, ${name}`;
}

function connect(host: string, port: number = 0): string {
  return port === 0 ? `${host}:default` : `${host}:${port}`;
}

function sumAll(...values: number[]): number {
  let total = 0;
  for (const v of values) {
    total += v;
  }
  return total;
}

function norm(p: { x: number; y: number }): number { // destructured use
  const { x, y } = p;
  return Math.sqrt(x * x + y * y);
}

// ── function types, callbacks, higher-order ────────────────────────────────
type BinaryOp = (a: number, b: number) => number;

function applyOp(op: BinaryOp, a: number, b: number): number {
  return op(a, b);
}

function compose(f: (n: number) => number, g: (n: number) => number): (n: number) => number {
  return (n: number) => f(g(n));
}

function maybeCall(cb?: (n: number) => void): void {
  cb?.(42); // optional call
}



// Value-returning callbacks are the safe form for parameter-using bodies:
// a lambda body that BUILDS A STRING hoists its snprintf above the lambda
// (the parameter is then out of scope) — see README findings.
function apply42(cb: (n: number) => number): number {
  return cb(42);
}

// ── closures ───────────────────────────────────────────────────────────────
// The STATEFUL closure (counter factory) now works: the ownership scan
// walks lambda bodies, and the escaping lambda captures [=] mutable.
function makeScale(k: number): (n: number) => number {
  return (n: number) => n * k;
}

function makeCounter(start: number): () => number {
  let count = start;
  return () => {
    count += 1;
    return count;
  };
}

// ── recursion ──────────────────────────────────────────────────────────────
function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

function fib(n: number): number {
  if (n < 2) {
    return n;
  }
  return fib(n - 1) + fib(n - 2);
}

function isEven(n: number): boolean {
  return n === 0 ? true : isOdd(n - 1);
}
function isOdd(n: number): boolean {
  return n === 0 ? false : isEven(n - 1);
}

// ── generics ───────────────────────────────────────────────────────────────
// Generic calls are safe used INLINE in expressions (the corpus's
// generic-bounds case); a generic RETURN stored into a variable resolves
// to `int` in the current tree, so results are consumed immediately.
function identity<T>(v: T): T {
  return v;
}

// Generic calls with STRING LITERAL arguments do not resolve (T deduces the
// C array type) — go through a concrete-typed helper.
function longestOf(a: string, b: string): string {
  return longest(a, b);
}

function longest<T extends { length: number }>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}

function pairUp<T, U>(a: T, b: U): string {
  return `${a}~${b}`;
}

// ── function objects + void + early return ─────────────────────────────────
const computeAnswer = (): number => 6 * 7;

// Radix conversion via divmod - toString(radix) lowers per-target (the
// zephyr shim returns std::string, the native one const char*) so the loop
// form is the portable idiom.
const RADIX_DIGITS = '0123456789abcdef';

function toRadix(value: number, radix: number): string {
  let out = '';
  let v = value;
  while (v > 0) {
    const digit = v - radix * Math.floor(v / radix);
    out = RADIX_DIGITS.charAt(digit) + out;
    v = Math.floor(v / radix);
  }
  return out === '' ? '0' : out;
}

function classify(n: number): string {
  if (n < 0) {
    return 'negative';
  }
  if (n === 0) {
    return 'zero';
  }
  return 'positive';
}

// typeof narrowing over a union: variant params need the C++17 pin the
// scaffold now applies when std::variant/holds_alternative is in the
// emitted source (the strategy reports supportsStdVariant accordingly).
function describeId(id: number | string): string {
  if (typeof id === 'number') {
    return 'num:' + id.toFixed(0);
  }
  return 'str:' + id;
}

function logIfOdd(n: number): void { // void return
  if (n % 2 === 0) {
    return; // early void return
  }
  report(`F99 odd=${n}`);
}

function sectionFunctions(): void {
  const divStr: string = divide(7, 2).toFixed(2);
  report(`F01 decls: add=${add(2, 3)} sub=${subtract(9, 4)} mul=${multiply(6, 7)}`);
  report(`F01b decls: div=${divStr}`);
  report(`F02 clamp: lo=${clamp(-5, 0, 10)} mid=${clamp(5, 0, 10)} hi=${clamp(50, 0, 10)}`);
  report(`F03 params: ${greet('gal')} | ${greet('bob', 'hi')} | ${connect('host')} | ${connect('host', 8080)}`);
  report(`F04 rest: sum=${sumAll(1, 2, 3, 4)} norm=${norm({ x: 3, y: 4 }).toFixed(1)}`);
  report(`F05 ops: apply=${applyOp(multiply, 6, 7)} apply=${applyOp((a: number, b: number): number => a + b * 2, 1, 5)}`);
  const composed = compose((n: number) => n * 2, (n: number) => n + 1);
  report(`F06 compose: doubled(5)=${composed(5)} identity=${identity<number>(9)}`);
  report(`F07 generics: longest=${longestOf('ab', 'abcd')} pair=${pairUp(3, 9)} pair=${pairUp(12, 5)}`);
  maybeCall((_n: number): void => {
    report('F08 callback ran'); // constant body: a lambda that MUTATES state or
    // builds a string hits the ownership/hoisting bugs (README findings)
  });
  // maybeCall(undefined) crashes the native tier: the ?.() guard cannot detect an empty std::function (README findings)
  const increment = (n: number): number => n + 1;
  report(`F08b callback value: got=${apply42(increment)}`);

  const triple = makeScale(3);
  let folded = 0;
  [1, 2, 3].forEach((v: number): void => {
    folded += triple(v); // closure over the factory's parameter
  });
  report(`F09 closures: triple7=${triple(7)} folded=${folded} answer=${computeAnswer()}`);

  let captured = 0;
  const bumpAll = [10, 20, 30];
  bumpAll.forEach((v: number): void => {
    captured += v; // forEach fold over a captured local
  });
  report(`F10 captured: total=${captured}`);
  const tick = makeCounter(90);
  tick();
  report(`F10b counter: tick=${tick()}`);
  report(`F11 recursion: fact5=${factorial(5)} fib10=${fib(10)} even10=${isEven(10)} odd7=${isOdd(7)}`);
  report(`F12 branches: ${classify(-3)} / ${classify(0)} / ${classify(12)}`);
  report(`F12b narrowing: ${describeId(5)} ${describeId('five')}`);
  logIfOdd(4);
  logIfOdd(5);
}



// ═══════════════════════════════ 03 · OBJECTS ══════════════════════════════
// data-only object literals (nested, mixed member types), property access
// forms, explicit field-by-field merge (object spread is unsupported —
// C++ structs have fixed shape), interfaces consumed structurally through
// parameters, the presence-flag idiom (optional struct fields flatten in
// C++), and the Map / Set dictionary idioms with a parallel key array
// (Map.keys() has no lowering on firmware targets).

interface SensorReading {
  milliVolts(): number;
  describe(): string;
}

// Interface-typed parameters take CLASS INSTANCES — a braced literal does
// not lower (the annotation resolves to a pointer but the initializer is
// emitted verbatim), and an interface with ONLY FIELDS does not emit the
// inheritance base clause, so the interface carries the methods and the
// implementers hold the data (see README findings).
class FixedReading implements SensorReading {
  private readonly rid: string;
  private readonly mv: number;
  private readonly healthy: boolean;

  constructor(rid: string, mv: number, healthy: boolean) {
    this.rid = rid;
    this.mv = mv;
    this.healthy = healthy;
  }

  milliVolts(): number {
    return this.mv;
  }

  describe(): string {
    return `${this.rid}=${this.mv}mV ok=${this.healthy}`;
  }
}

class SimReading implements SensorReading {
  private readonly factor: number;

  constructor(factor: number) {
    this.factor = factor;
  }

  milliVolts(): number {
    return 3300 / this.factor;
  }

  describe(): string {
    return `sim=${this.milliVolts().toFixed(0)}mV`;
  }
}

function summarize(r: SensorReading): string {
  return r.describe();
}

function pickMilliVolts(r: SensorReading): number {
  return r.milliVolts();
}

// Optionality cannot be runtime-tested on struct fields (it flattens to
// the value type in C++). The supported idiom is an explicit boolean flag
// beside the field.
class Flagged {
  a: number;
  b: number;
  hasB: boolean;

  constructor(a: number, b: number, hasB: boolean) {
    this.a = a;
    this.b = b;
    this.hasB = hasB;
  }
}

function flaggedB(o: Flagged): string {
  return `a=${o.a} b=${o.hasB ? o.b : -1} has=${o.hasB}`;
}

function sectionObjects(): void {
  // ── data-only literals: nesting, mixed member types ──────────────────────
  const config = {
    host: 'localhost',
    port: 8080,
    tls: false,
    tags: ['edge', 'core'],
    bounds: {
      min: 0,
      max: 100,
      label: 'range',
    },
  };

  // ── explicit merge (object spread is not supported: fixed-shape structs) ─
  const defaults = { retries: 1, timeout: 100 };
  const overrides = { timeout: 250 };
  const effective = {
    retries: defaults.retries,
    timeout: overrides.timeout,
  };

  // ── Map and Set ──────────────────────────────────────────────────────────
  // Map.set/has/size lower; .get() outside a lowered iteration does not, so
  // the fold rides parallel arrays (the bench-console idiom).
  let counts = new Map<string, number>();
  const countKeys: string[] = []; // parallel key array (Map.keys() unsupported)
  const countVals: number[] = [];
  counts.set('alpha', 2);
  countKeys.push('alpha');
  countVals.push(2);
  counts.set('beta', 5);
  countKeys.push('beta');
  countVals.push(5);
  counts.set('gamma', 1);
  countKeys.push('gamma');
  countVals.push(1);
  counts.set('alpha', 3); // overwrite in the map
  countVals[0] = 3; // ...and in the parallel store

  let mapSum = 0;
  for (const cv of countVals) {
    mapSum += cv;
  }

  let seen = new Set<string>();
  seen.add('x');
  seen.add('y');
  seen.add('x'); // duplicate is a no-op
  seen.delete('y');

  let numLabels = new Map<number, string>();
  numLabels.set(1, 'one');
  numLabels.set(2, 'two');
  const labelPairs = ['1=one', '2=two'];

  report(`O01 literal: host=${config.host} port=${config.port} tls=${config.tls}`);
  report(`O02 access: tag0=${config.tags[0]} tagN=${config.tags.length} label=${config.bounds.label}`);
  report(`O03 nested: min=${config.bounds.min} max=${config.bounds.max} label=${config.bounds.label}`);
  report(`O04 flagged: [${flaggedB(new Flagged(1, 0, false))}] [${flaggedB(new Flagged(1, 2, true))}]`);
  report(`O05 merge: retries=${effective.retries} timeout=${effective.timeout}`);
  report(`O06 interface: ${summarize(new FixedReading('s1', 3300, true))} mv=${pickMilliVolts(new SimReading(3))}`);
  report(`O07 interface: mv=${pickMilliVolts(new FixedReading('s2', 12, false))}`);
  report(`O08 map: sum=${mapSum} size=${counts.size} has=${counts.has('gamma') ? 'yes' : 'no'}`);
  report(`O09 set: size=${seen.size} has=${seen.has('x') ? 'yes' : 'no'} has=${seen.has('y') ? 'yes' : 'no'}`);
  report(`O10 map2: ${joinWords(labelPairs, ';')} size=${numLabels.size}`);
}



// ═══════════════════════════════ 04 · ARRAYS ═══════════════════════════════
// literals (nested, typed), element access and length, push/pop/shift/
// unshift, slice (positive indexes), indexOf/includes, explicit
// string-building folds (join() has no firmware lowering), map/filter/
// reduce (both arities)/find/findIndex/some/every/forEach, hand-rolled
// insertion sorts (sort() is likewise not lowered), spread copies,
// destructuring with holes and rest, all the loops, chained pipelines,
// and fixed-capacity buffers (new Array<T>(n) — the embedded shape).

function joinNums(nums: number[], sep: string): string {
  let jnOut = '';
  for (let jnI = 0; jnI < nums.length; jnI += 1) {
    if (jnI > 0) {
      jnOut += sep;
    }
    jnOut += `${nums[jnI]}`;
  }
  return jnOut;
}

function joinWords(strs: string[], sep: string): string {
  let jwOut = '';
  for (let jwI = 0; jwI < strs.length; jwI += 1) {
    if (jwI > 0) {
      jwOut += sep;
    }
    jwOut += strs[jwI];
  }
  return jwOut;
}

function sectionArrays(): void {
  const samples: number[] = [4, 8, 15, 16, 23, 42];
  const words = ['delta', 'alpha', 'charlie', 'bravo'];
  const matrix = [
    [1, 2],
    [3, 4],
  ];
  const spliceSrc: number[] = [4, 8, 15, 16, 23, 42]; // hole-destructure source
  const stack: number[] = [];
  stack.push(1);
  stack.push(2);
  stack.push(3);
  const popped = stack.pop() ?? -1;
  const queue = [9, 8, 7];
  const firstOut = queue.shift() ?? -1;
  queue.unshift(6);


  // ── searching and indexing ───────────────────────────────────────────────
  let idx = -1;
  let has23 = false;
  for (let si = 0; si < samples.length; si += 1) {
    if (samples[si] === 16) {
      idx = si;
    }
    if (samples[si] === 23) {
      has23 = true;
    }
  }
  const missing = -1;
  const mid0 = samples[2];
  const mid1 = samples[3];
  const tail0 = samples[4];
  const tail1 = samples[5];

  // ── explicit string build (join() has no firmware lowering) ─────────────
  let joined = '';
  for (let jwI = 0; jwI < words.length; jwI += 1) {
    if (jwI > 0) {
      joined += '|';
    }
    joined += words[jwI];
  }

  // ── folds (the explicit-loop forms of map/filter/reduce/find — the
  // callback methods have no lowering on this target; the loop is the idiom,
  // and src/array-methods.ts carries the method forms for the native tier) ──
  let doubled0 = 0;
  {
    const src = [4, 8, 15, 16, 23, 42];
    const mapped: number[] = [];
    for (const n of src) {
      mapped.push(n * 2);
    }
    doubled0 = mapped[0];
  }
  let evensCount = 0;
  for (const n of samples) {
    if (n % 2 === 0) {
      evensCount += 1;
    }
  }
  let samplesTotal = 0;
  for (const n of samples) {
    samplesTotal += n;
  }
  let noInit = 0;
  let niFirst = true;
  for (const n of samples) {
    if (niFirst) {
      noInit = n;
      niFirst = false;
    } else {
      noInit += n;
    }
  }
  let found = 0;
  let foundIdx = -1;
  for (let fi = 0; fi < samples.length; fi += 1) {
    if (foundIdx === -1 && samples[fi] > 20) {
      found = samples[fi];
      foundIdx = fi;
    }
  }
  let anyBig = false;
  for (const n of samples) {
    if (n > 40) {
      anyBig = true;
    }
  }
  let allSmall = true;
  for (const n of samples) {
    if (n >= 100) {
      allSmall = false;
    }
  }

  let forEachSum = 0;
  for (const n of samples) {
    forEachSum += n;
  }

  // ── sorting (inlined insertion sorts — sort() has no firmware lowering) ──
  const ascWords: string[] = [];
  for (let cpA = 0; cpA < words.length; cpA += 1) {
    ascWords.push(words[cpA]);
  }
  for (let awI = 1; awI < ascWords.length; awI += 1) {
    const awKey = ascWords[awI];
    let awJ = awI - 1;
    while (awJ >= 0 && awKey < ascWords[awJ]) {
      ascWords[awJ + 1] = ascWords[awJ];
      awJ -= 1;
    }
    ascWords[awJ + 1] = awKey;
  }
  const byLength: string[] = [];
  for (let cpB = 0; cpB < words.length; cpB += 1) {
    byLength.push(words[cpB]);
  }
  for (let blI = 1; blI < byLength.length; blI += 1) {
    const blKey = byLength[blI];
    let blJ = blI - 1;
    while (blJ >= 0 && blKey.length < byLength[blJ].length) {
      byLength[blJ + 1] = byLength[blJ];
      blJ -= 1;
    }
    byLength[blJ + 1] = blKey;
  }
  const descending: number[] = [];
  for (let cpC = 0; cpC < samples.length; cpC += 1) {
    descending.push(samples[cpC]);
  }
  for (let deI = 1; deI < descending.length; deI += 1) {
    const deKey = descending[deI];
    let deJ = deI - 1;
    while (deJ >= 0 && deKey > descending[deJ]) {
      descending[deJ + 1] = descending[deJ];
      deJ -= 1;
    }
    descending[deJ + 1] = deKey;
  }
  let ascStr = '';
  for (let asI = 0; asI < ascWords.length; asI += 1) {
    if (asI > 0) {
      ascStr += ',';
    }
    ascStr += ascWords[asI];
  }
  let lenStr = '';
  for (let leI = 0; leI < byLength.length; leI += 1) {
    if (leI > 0) {
      lenStr += ',';
    }
    lenStr += byLength[leI];
  }
  let descStr = '';
  for (let deI2 = 0; deI2 < descending.length; deI2 += 1) {
    if (deI2 > 0) {
      descStr += ',';
    }
    descStr += `${descending[deI2]}`;
  }

  // ── pipeline (staged loops: filter >10, map -10, fold *100+) ─────────────
  let pipeline = 0;
  {
    let stage = 0;
    for (const n of samples) {
      if (n > 10) {
        stage = stage * 100 + (n - 10);
      }
    }
    pipeline = stage;
  }
  let maxViaReduce = samples[0];
  for (const n of samples) {
    if (n > maxViaReduce) {
      maxViaReduce = n;
    }
  }

  // ── loops ────────────────────────────────────────────────────────────────
  let forSum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    forSum += samples[i];
  }

  let ofSum = 0;
  for (const sample of samples) {
    ofSum += sample;
  }

  // for-in is deliberately absent: the lowering iterates VALUES and then
  // indexes with them (spliceSrc[8] → out-of-bounds) — a semantic bug
  // documented in the README. The index loop above is the keys idiom.

  let whileSum = 0;
  let w = 0;
  while (w < samples.length) {
    whileSum += samples[w];
    w += 1;
  }

  let doSum = 0;
  let d = 0;
  do {
    doSum += samples[d];
    d += 1;
  } while (d < 3);

  // ── fixed-capacity buffer (the embedded idiom) ───────────────────────────
  const ring = new Array<number>(4);
  ring[0] = 100;
  ring[1] = 200;

  // ── destructuring and spread forms ───────────────────────────────────────
  // string-array destructuring reads garbage on the native tier - number
  // arrays destructure fine, strings are read by index here
  const [head, , third] = spliceSrc; // hole skips 8
  const lead = words[0];
  const rest: string[] = [];
  for (let ri = 1; ri < words.length; ri += 1) {
    rest.push(words[ri]);
  }
  const copy: number[] = [];
  for (const cs of samples) {
    copy.push(cs);
  }
  copy.push(99);
  const swap = [1, 2];
  const swapTmp = swap[0];
  swap[0] = swap[1];
  swap[1] = swapTmp; // element-wise destructuring swap mis-evaluates natively
  const flatSum = matrix[0][0] + matrix[1][1];

  report(`A01 basics: len=${samples.length} first=${samples[0]} last=${samples[5]} matrix=${flatSum}`);
  report(`A02 stack: popped=${popped.toFixed(0)} firstOut=${firstOut.toFixed(0)} q0=${queue[0].toFixed(0)} q1=${queue[1].toFixed(0)} q2=${queue[2].toFixed(0)}`);
  report(`A03 search: idx=${idx} missing=${missing} has23=${has23} mid=${mid0.toFixed(0)}/${mid1.toFixed(0)} tail=${tail0.toFixed(0)}/${tail1.toFixed(0)}`);
  report(`A04 join: ${joined}`);
  report(`A05 transform: doubled0=${doubled0} evens=${evensCount} total=${samplesTotal} noInit=${noInit}`);
  report(`A06 find: found=${found} idx=${foundIdx} anyBig=${anyBig} allSmall=${allSmall}`);
  report(`A07 forEach: sum=${forEachSum}`);
  report(`A08 sort: words=${ascStr} len=${lenStr} desc=${descStr}`);
  report(`A09 pipeline: value=${pipeline} max=${maxViaReduce}`);
  report(`A10 loops: for=${forSum} of=${ofSum} while=${whileSum} do=${doSum}`);
  report(`A11 ring: r0=${ring[0]} r1=${ring[1]} len=${ring.length}`);
  report(`A12 destructure: head=${head.toFixed(0)} third=${third.toFixed(0)} lead=${lead} rest=${rest.length} copy=${copy.length}`);
  report(`A13 swap: ${swap[0].toFixed(0)}/${swap[1].toFixed(0)}`);
}

// ═══════════════════════════════ 05 · CLASSES ══════════════════════════════
// fields and initialization, constructors (including parameter
// properties), methods and `this`, access modifiers, static members,
// getters, inheritance with super() and override, abstract classes with
// polymorphic dispatch, interfaces with implements (and interface-typed
// containers), virtual-tag dispatch (the embedded replacement for
// instanceof — user hierarchies have no RTTI), composition, and method
// chaining. Setters and generic-class `new` are deliberately absent
// (README findings).

class Accumulator {
  static instances: number = 0;

  private total: number = 0;
  private readonly name: string;

  constructor(name: string, private readonly step: number) {
    this.name = name;
    Accumulator.instances += 1;
  }

  bump(): number {
    this.total += this.step;
    return this.total;
  }

  get value(): number {
    return this.total;
  }

  describe(): string {
    return `${this.name}=${this.total}`;
  }
}

class Device {
  constructor(protected readonly id: string) {}

  identify(): string {
    return `device:${this.id}`;
  }

  label(): string {
    return `base(${this.id})`;
  }
}

class TempSensor extends Device {
  private readonly scale: number;

  constructor(id: string, scale: number) {
    super(id);
    this.scale = scale;
  }

  override label(): string {
    return `sensor(${this.id})*${this.scale}`;
  }

  level(): number {
    return 100 * this.scale;
  }
}

interface Shape {
  area(): number;
  kind(): string;
}

abstract class BaseShape implements Shape {
  protected readonly tag: string;

  constructor(tag: string) {
    this.tag = tag;
  }

  abstract area(): number;

  kind(): string {
    return this.tag;
  }

  summary(): string {
    return `${this.tag}:${this.area().toFixed(1)}`;
  }
}

class SquareShape extends BaseShape {
  private readonly side: number;

  constructor(side: number) {
    super('square');
    this.side = side;
  }

  area(): number {
    return this.side * this.side;
  }
}

class RectShape extends BaseShape {
  private readonly w: number;
  private readonly h: number;

  constructor(w: number, h: number) {
    super('rect');
    this.w = w;
    this.h = h;
  }

  area(): number {
    return this.w * this.h;
  }
}

class Engine {
  private rpm: number = 0;

  setRpm(value: number): Engine {
    this.rpm = value;
    return this; // chaining
  }

  get revolutions(): number {
    return this.rpm;
  }
}

class Car {
  private readonly engine: Engine;

  constructor() {
    this.engine = new Engine(); // composition
  }

  rev(to: number): Car {
    this.engine.setRpm(to);
    return this;
  }

  status(): string {
    return `engine@${this.engine.revolutions}`;
  }
}

function sectionClasses(): void {
  const acc = new Accumulator('acc', 5);
  acc.bump();
  acc.bump();
  report(`C01 basics: ${acc.describe()} value=${acc.value.toFixed(0)} instances=${Accumulator.instances.toFixed(0)}`);
  const sensor = new TempSensor('temp', 3);
  report(`C02 inheritance: ${sensor.identify()} label=${sensor.label()} level=${sensor.level().toFixed(0)}`);
  const asDevice: Device = sensor;
  report(`C03 polymorphic: ${asDevice.label()}`);
  const shapes: Shape[] = [new SquareShape(4), new RectShape(2, 6)];
  let shapeAreaSum = 0;
  for (const shape of shapes) {
    shapeAreaSum += shape.area();
  }
  report(`C04 shapes: total=${shapeAreaSum} kinds=${shapes[0].kind()}+${shapes[1].kind()}`);
  const asBase: BaseShape = new SquareShape(4);
  report(`C05 abstract: ${asBase.summary()} area1=${shapes[0].area()}`);
  // Dispatch on a virtual tag — the embedded replacement for instanceof
  // (user-class hierarchies have no RTTI lowering on firmware targets).
  let tagList = '';
  for (const shape of shapes) {
    if (tagList.length > 0) {
      tagList += ',';
    }
    tagList += shape.kind();
  }
  report(`C06 dispatch: ${tagList} square=${tagList.startsWith('square') ? 'yes' : 'no'} rect=${tagList.startsWith('rect') ? 'yes' : 'no'}`);
  const car = new Car();
  const status = car.rev(4200).status();
  report(`C07 chaining: ${status}`);
}



// ═══════════════════════════ 06 · CONTROL FLOW ═════════════════════════════
// if/else-if chains, switch over numbers / strings / enums with grouped
// cases, labeled break/continue, while / do-while semantics, ternaries,
// short-circuit evaluation with side effects, nullish forms, Math helpers,
// Number/parseFloat/parseInt conversions, toString(radix), toFixed,
// charCodeAt/charAt, and comparison idioms.

enum OpMode {
  Idle,
  Run,
  Sleep,
}

function bucket(n: number): string {
  if (n < 10) {
    return 'low';
  } else if (n < 100) {
    return 'mid';
  } else {
    return 'high';
  }
}

function modeName(mode: OpMode): string {
  switch (mode) {
    case OpMode.Idle:
      return 'idle';
    case OpMode.Run:
      return 'run';
    case OpMode.Sleep:
      return 'sleep';
    default:
      return '?';
  }
}

function httpClass(code: number): string {
  switch (code) {
    case 200:
      return 'ok';
    case 301:
    case 302:
      return 'redirect';
    case 404:
      return 'missing';
    default:
      return 'other';
  }
}

function planet(code: string): string {
  switch (code) {
    case 'M':
      return 'mars';
    case 'E':
      return 'earth';
    default:
      return 'unknown';
  }
}

function gridSearch(target: number): string {
  let visited = 0;
  let stoppedAt = -1;
  outer:
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      if (row * col > target) {
        break outer;
      }
      if ((row + col) % 2 === 0) {
        continue outer;
      }
      visited += 1;
    }
    stoppedAt = row;
  }
  return `visited=${visited} stopped=${stoppedAt}`;
}

let evalCount = 0;
function counted(v: boolean): boolean {
  evalCount += 1;
  return v;
}

function safeLen(s: string): number {
  return s.length === 0 ? -1 : s.length;
}

function sectionControlFlow(): void {
  report(`X01 if: ${bucket(5)} / ${bucket(50)} / ${bucket(500)}`);
  report(`X02 switch-enum: ${modeName(OpMode.Run)} ${modeName(OpMode.Sleep)} ${modeName(OpMode.Idle)}`);
  report(`X03 switch-group: ${httpClass(200)} ${httpClass(302)} ${httpClass(404)} ${httpClass(500)}`);
  report(`X04 switch-str: ${planet('M')} ${planet('E')} ${planet('X')}`);
  report(`X05 loops: ${gridSearch(3)}`);

  // NOTE: && / || return the right result natively but evaluate BOTH sides
  // (no short-circuit) — side-effecting guards are a README finding.
  const shortCircuit = false && true;
  const orResult = true || true;
  report(`X06 short-circuit: and=${shortCircuit ? 'yes' : 'no'} or=${orResult ? 'yes' : 'no'}`);

  const len = safeLen('');
  const lenReal = safeLen('abcd');
  report(`X07 nullish: len=${len} len2=${lenReal} truthy=${safeLen('') === -1 ? 'no' : 'yes'}`);

  report(`X08 bitwise: and=${(12 & 10).toFixed(0)} or=${(12 | 10).toFixed(0)} xor=${(12 ^ 10).toFixed(0)} not=${(~12).toFixed(0)}`);
  report(`X09 math: floor=${Math.floor(3.7).toFixed(0)} ceil=${Math.ceil(3.2).toFixed(0)} round=${Math.round(3.5).toFixed(0)} trunc=${Math.trunc(-3.7).toFixed(0)}`);
  report(`X10 math: abs=${Math.abs(-9).toFixed(0)} min=${Math.min(4, 2, 8).toFixed(0)} max=${Math.max(4, 2, 8).toFixed(0)} pow=${Math.pow(2, 8).toFixed(0)} sqrt=${Math.sqrt(81).toFixed(0)}`);
  report(`X11 convert: n=${Number('42').toFixed(0)} f=${parseFloat('3.5').toFixed(1)} p=${parseInt('17', 10).toFixed(0)} hex=${toRadix(255, 16)} bin=${toRadix(10, 2)}`);
  report(`X11b bitwise2: shl=${(1 << 6).toFixed(0)} shr=${(64 >> 3).toFixed(0)} ushr=${((268435456) >>> 28).toFixed(0)}`);
  report(`X12 convert: fixed=${(1 / 3).toFixed(4)} char=${'A'.charCodeAt(0).toFixed(0)} at=${'hello'.charAt(1)} cmp=${'beta' > 'alpha' ? 'yes' : 'no'} eq=${1 === 1.0 ? 'yes' : 'no'}`);

  // ── do-while vs while (runs-at-least-once semantics) ────────────────────
  let runs = 0;
  let flag = false;
  while (flag) {
    runs += 1; // never
  }
  do {
    runs += 1; // exactly once
  } while (flag);
  report(`X13 while-semantics: runs=${runs}`);
}




// ═══════════════════════════════ ENTRY ═════════════════════════════════════

report('=== ts-patterns gallery ===');
sectionVariables();
sectionFunctions();
sectionObjects();
sectionArrays();
sectionClasses();
sectionControlFlow();
report('=== gallery complete ===');
