// ---------------------------------------------------------------------------
// scope-demo-port-gaps.test.ts — regressions from the zephyr-scope demo round.
//
// The demo (an ASCII oscilloscope: PWM waveform synth + ADC capture + UART
// console) surfaced one silent-wrong-code bug and five hard-error/wrong-output
// bugs in the Zephyr lowering, all fixed in this round:
//
//   1. `const vals: number[] = []` + loop .push() promoted the local to
//      __tc_StaticArray<T, 2> (capacity hard-bound to the empty literal);
//      push() silently DROPS past capacity. Unbounded-push locals now lower
//      to std::vector on vector-capable targets; a non-vector target gets a
//      sized default plus an explicit warning.
//   2. `s += part` on a string lowered to pointer arithmetic (`const char* +=
//      char*`). Strings are concat-then-rebind; the lowering now emits a
//      snprintf rebind into a STATIC buffer (the pointer must outlive the
//      statement — later reads, loop iterations, the next async run() slice).
//   3. `.push`/`.includes`/`.indexOf` on a std::vector receiver fell through
//      verbatim (g++: "no member named 'push'") — the vector-method lowering
//      was gated hosted-only, but annotated `T[]` declarations lower to
//      std::vector on Zephyr too. Now gated on the receiver's resolved type,
//      with __tc_includes/__tc_indexOf vector overloads shipped by the Zephyr
//      vector_methods polyfill.
//   4. `for (const e of map)` iterates std::pair — `e[1]` emitted as a pair
//      subscript (no operator[]). Now lowers to .first/.second.
//   5. `static nextId = 1` on a class emitted `static inline` (C++17) under
//      the C++14 AUTOSAR profile. Now in-class declaration + out-of-class
//      definition.
//   6. snprintf classifier gaps: a class-method call returning const char*
//      (`w.describe()`), a string-array element (`args[i]`), and a map value
//      read (`m.get(k)`) all defaulted to %d — pointer-as-int garbage on
//      device. Math.PI also float-demoted via an `f` suffix (precision loss);
//      literals beyond float precision now stay double.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpileZephyrStrategy } from '../../setup';

describe('FIX 1: unbounded-push array literals', () => {
  it('routes a loop-pushed local literal to std::vector, not a capacity-2 StaticArray', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      function collect(n: number): number {
        const vals: number[] = [];
        for (let i = 0; i < n; i++) { vals.push(i); }
        let total = 0;
        for (let i = 0; i < vals.length; i++) { total += vals[i]; }
        return total;
      }
      UART0.writeLine(collect(4).toFixed(0));
    `);

    // The declaration is a growable vector…
    expect(r.cpp).toMatch(/std::vector<double> vals/);
    // …never the empty-literal-sized StaticArray that silently dropped pushes.
    expect(r.cpp).not.toMatch(/__tc_StaticArray<[^>]*,\s*2>\s+vals/);
    // And the push site lowers to push_back.
    expect(r.cpp).toMatch(/vals\.push_back\(/);
  });

  it('keeps bounded (non-loop) literal pushes on StaticArray with a sized capacity', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      function run(): void {
        const xs: number[] = [1, 2];
        xs.push(3);
        UART0.writeLine(xs[0].toFixed(0));
      }
      run();
    `);

    // 2 literal elements + 1 push site + 2 slack = capacity 5.
    expect(r.cpp).toMatch(/__tc_StaticArray<double,\s*5>\s+xs/);
    expect(r.cpp).toMatch(/\(xs\)\.push\(3\)/);
  });

  it('a module literal mutated from a class method AND a function stays a vector (bench-console shape)', () => {
    // bench-console split here: the class-method element-assign promoted the
    // declaration to __tc_StaticArray while the free function's .push
    // lowered to push_back — "no member named 'push_back'".
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const order: string[] = [];
      class Sorter {
        swap(i: number, j: number): void {
          const tmp = order[i];
          order[i] = order[j];
          order[j] = tmp;
        }
      }
      function bump(n: string): void {
        if (!order.includes(n)) { order.push(n); }
      }
      const s = new Sorter();
      s.swap(0, 1);
      bump('a');
      UART0.writeLine(order[0]);
    `);

    expect(r.cpp).toMatch(/std::vector<std::string> order/);
    expect(r.cpp).not.toMatch(/__tc_StaticArray<[^\n]*order/);
    expect(r.cpp).toMatch(/order\.push_back\(n\)/);
  });
});

describe('FIX 2: string compound assignment', () => {
  it('lowers s += part to the native std::string append (one string model)', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      function banner(n: number): void {
        let line = 'row:';
        for (let i = 0; i < n; i++) { line += ' #'; }
        UART0.writeLine(line);
      }
      banner(4);
    `);

    // The target is an owned std::string — a string append composes natively
    // (unbounded, no intermediate buffer, no lifetime hazard). The snprintf
    // accumulation path remains only for FORMATTED appends (%g/%d).
    expect(r.cpp).toMatch(/line\.append\(" #"\)/);
    expect(r.cpp).not.toMatch(/__cuttlefish_str_/);
  });

  it('classifies a char append as %c (string indexing receiver)', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const RAMP = ' .:-=+*#%@';
      function row(level: number): string {
        let out = '|';
        out += RAMP[level];
        return out + '|';
      }
      UART0.writeLine(row(3));
    `);

    // A char append composes natively under the one string model:
    // append(1, char). A double-typed index still casts.
    expect(r.cpp).toMatch(/out\.append\(1, RAMP\[static_cast<int>\(level\)\]\)/);
  });
});

describe('FIX 3: vector receivers on the StaticArray target', () => {
  it('module-level annotated array: push → push_back, includes → __tc_includes', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const order: string[] = [];
      function bump(n: string): void {
        order.push(n);
        if (!order.includes(n)) { UART0.writeLine('dup'); }
      }
      bump('a');
      UART0.writeLine(order[0]);
    `);

    expect(r.cpp).toMatch(/order\.push_back\(n\)/);
    expect(r.cpp).toMatch(/__tc_includes\(order, n\)/);
    // The vector overloads ship (template polyfill, <vector> included).
    expect(r.cpp).toMatch(/int __tc_indexOf\(const std::vector<T>& v, const T& val\)/);
    expect(r.cpp).toMatch(/bool __tc_includes\(const std::vector<T>& v, const T& val\)/);
    // No raw member calls survive.
    expect(r.cpp).not.toMatch(/order\.push\(/);
    expect(r.cpp).not.toMatch(/order\.includes\(/);
  });

  it('string .includes / .startsWith get Zephyr helper definitions', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const line = 'hello world';
      if (line.includes('wor')) { UART0.writeLine('yes'); }
      if (line.startsWith('hell')) { UART0.writeLine('also'); }
    `);

    // Both helpers exist under the one string model (previously only
    // endsWith did): std::string receivers, const char* needles.
    expect(r.cpp).toMatch(/bool __tc_includes\(const std::string& s, const char\* needle\)/);
    expect(r.cpp).toMatch(/bool __tc_startsWith\(const std::string& s, const char\* prefix\)/);
    expect(r.cpp).toMatch(/__tc_includes\(line, "wor"\)/);
  });
});

describe('FIX 4: for-of over a Map', () => {
  it('entry[i] lowers to .first/.second on the pair', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const counts = new Map<string, number>();
      function total(): number {
        let sum = 0;
        for (const entry of counts) { sum += entry[1]; }
        return sum;
      }
      UART0.writeLine(total().toFixed(0));
    `);

    expect(r.cpp).toMatch(/for \(const std::pair<const std::string, double>& entry : counts\)/);
    expect(r.cpp).toMatch(/sum \+= entry\.second/);
    expect(r.cpp).not.toMatch(/entry\[1\]/);
  });
});

describe('FIX 5: static class members under C++14', () => {
  it('emits in-class declaration + out-of-class definition, never `static inline`', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      class Waveform {
        static nextId: number = 1;
        readonly id: number;
        constructor() {
          this.id = Waveform.nextId++;
        }
      }
      const w = new Waveform();
      UART0.writeLine(w.id.toFixed(0));
    `);

    expect(r.cpp).toMatch(/static double nextId;/);
    expect(r.cpp).toMatch(/double Waveform::nextId = 1;/);
    // Only inline VARIABLES are C++17; the framework's own `static inline`
    // FUNCTION shims are C++14-legal and may appear — assert the field shape.
    expect(r.cpp).not.toMatch(/static inline double nextId/);
  });
});

describe('FIX 6: snprintf specifier classification', () => {
  it('a class method returning a string formats as %s, not %d', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      class Wave {
        describe(): string { return 'wave'; }
      }
      const w = new Wave();
      UART0.writeLine(\`wave → \${w.describe()}\`);
    `);

    expect(r.cpp).toMatch(/"wave → %s", \(w->describe\(\)\)\.c_str\(\)/);
  });

  it('a string-array element in a template formats as %s', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      function show(args: string[]): void {
        UART0.writeLine(\`first=\${args[0]}\`);
      }
      show(['x']);
    `);

    expect(r.cpp).toMatch(/"first=%s", \(args\[0\]\)\.c_str\(\)/);
  });

  it('a Map value read (and a ternary over one) formats as %g', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const counts = new Map<string, number>();
      counts.set('a', 1.5);
      UART0.writeLine(\`v=\${counts.get('a')}\`);
      UART0.writeLine(\`t=\${counts.has('a') ? counts.get('a') : 0}\`);
    `);

    expect(r.cpp).toMatch(/"v=%.15g", counts\.at\("a"\)/);
    expect(r.cpp).toMatch(/%.15g", \(\(counts\.count\("a"\) > 0\) \? counts\.at\("a"\) : 0\)/);
  });

  it('Math.PI keeps double precision (no float-demoting f suffix)', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      function phase(t: number): number {
        return 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
      }
      UART0.writeLine(phase(0.25).toFixed(3));
    `);

    expect(r.cpp).toMatch(/2 \* 3\.141592653589793 \*/);
    expect(r.cpp).not.toMatch(/3\.141592653589793f/);
    // Short float-safe literals keep the historical f suffix (call-arg form).
    expect(r.cpp).toMatch(/phase\(0\.25f\)/);
  });

  it('for-of over a const string vector binds the element by value', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const HELP = ['one', 'two'];
      for (const h of HELP) { UART0.writeLine('  ' + h); }
    `);

    // `const char*& h` against a const vector's elements failed g++
    // (discards qualifiers); the pointer element is one word — by value.
    expect(r.cpp).toMatch(/for \(const std::string& h : HELP\)/);
    expect(r.cpp).not.toMatch(/const char\*& h/);
  });
});
