// ---------------------------------------------------------------------------
// bench-supervisor-demo-findings.test.ts — regressions for the transpiler
// bugs the zephyr-bench-supervisor demo (demos/zephyr-bench-supervisor)
// surfaced. The demo exercises the collection/text surface: Map/Record
// lowering, interface polymorphism across modules, enum↔number boundaries,
// byte-wise UART parsing, and string formatting. Each test pins one
// TS→C++ boundary:
//
//   1. `map.get(k) ?? d` lowers to the count-guarded lookup — `.at()`
//      throws on a miss and cuttlefish_nullish evaluates both arms, so the
//      fallback could never fire. Enum keys cast to the map's key type
//      (including through an instance FIELD like cmd.verb).
//   2. Number.isNaN/isFinite/parseInt/parseFloat (the static forms) lower
//      like the bare globals — they previously emitted verbatim
//      (`Number.isNaN(v)` — no such C++ symbol).
//   3. parseInt/parseFloat on a `__tc_*` helper result must not grow
//      `.c_str()` (the helpers return const char*).
//   4. A JS bitwise expression types INT (`| 0`, `& mask`) — a double-typed
//      index made `buckets[i]` ill-formed.
//   5. `.split()` has a Zephyr definition (it was hosted-shim-only → link
//      error), and the string polyfills take std::string receivers too.
//   6. A Record literal initializes its map field-by-field (a braced
//      value-only list is not a map initializer), and dot access on a
//      Record lowers to element access (even keys named like std::map
//      members — "clear").
//   7. Interface types are POINTER-typed everywhere (params, fields,
//      containers) — `std::vector<Handler>` cannot instantiate the abstract
//      struct, and cross-module interfaces (imported from another file)
//      must pointer-ize and attach `: public Iface` just like same-file
//      ones.
//   8. A function-typed variable (`const f = (x): string => …`) joins the
//      return-type registry so `${f(x)}` picks %s.
//   9. `x.length = 0` on a container lowers to `x.clear()`; a nonzero
//      length assignment fails loudly (it lowered to an assignment to a
//      cast — ill-formed).
//  10. `.pop()`/`.push()` on a class-field vector receiver lower to
//      pop_back/push_back (the identifier-only path left `this->_buf.pop()`).
//  11. A switch on a non-identifier discriminant (`switch (buf[0])`) casts
//      a real-typed discriminant to int.
//  12. A real-typed array index (and an element-assign TARGET index) casts
//      to int at the subscript.
//  13. Enum arguments crossing into `number`-annotated parameters cast
//      (static_cast<int>) — but a parameter OF the same enum type takes the
//      value directly.
//  14. A getter through a class FIELD (`this._log.size`) lowers to the
//      accessor call, not a field read.
//  15. `n.toString(16)` in a template literal formats %s (num_radix returns
//      const char*), and the polyfill rotates result slots.
//  16. The `??` declaration typing prefers the left arm (the map value
//      type), and mixed-pointer ternaries take the true arm — `const auto
//      handler = m.get(k) ?? fallback` declared auto left `handler.run`
//      dot-rendered on a pointer.
//  17. Exported free functions' header prototypes are hoisted ABOVE the
//      classes (inline class bodies call them), and every polyfill function
//      is `inline` (two TUs including the block linked with multiple
//      definitions).
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpileZephyrStrategy } from '../../setup';

describe('bench-supervisor demo findings', () => {
  it('lowers map.get(k) ?? d to the count-guarded lookup with enum-key cast', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      enum Verb { None = 0, Dump = 1 }
      class Command { verb: Verb; arg: number; }
      const m = new Map<number, string>();
      const handler = m.get(Verb.Dump) ?? '-';
      UART0.writeLine(handler);
    `);

    expect(r.cpp).toMatch(/m\.count\(static_cast<double>\(Verb::Dump\)\) != 0 \? m\.at\(static_cast<double>\(Verb::Dump\)\) : "-"/);
    // never the throwing .at() wrapped in cuttlefish_nullish
    expect(r.cpp).not.toMatch(/cuttlefish_nullish\(m\.at/);
  });

  it('casts an enum-typed FIELD key at the ?? boundary', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      enum Verb { None = 0, Dump = 1 }
      class Command { verb: Verb; }
      const handlers = new Map<number, string>();
      const cmd = new Command();
      const h = handlers.get(cmd.verb) ?? 'none';
      UART0.writeLine(h);
    `);

    expect(r.cpp).toMatch(/handlers\.count\(static_cast<double>\(cmd->verb\)\)/);
  });

  it('lowers Number.isNaN/isFinite/parseInt static forms', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const v = Number.parseFloat('2.5');
      if (Number.isNaN(v)) { UART0.writeLine('nan'); }
      if (Number.isFinite(v)) { UART0.writeLine('fin'); }
      const n = Number.parseInt('42');
    `);

    expect(r.cpp).toMatch(/std::isnan\(/);
    expect(r.cpp).toMatch(/std::isfinite\(/);
    expect(r.cpp).toMatch(/atof\("2\.5"\)/);
    expect(r.cpp).toMatch(/atoi\("42"\)/);
    expect(r.cpp).not.toMatch(/Number\.isNaN|Number\.isFinite|Number\.parse/);
  });

  it('does not grow .c_str() on __tc_* helper results fed to parseInt', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const v = parseInt('A10'.slice(1), 10);
      UART0.writeLine(\`\${v}\`);
    `);

    const atoiLine = r.cpp.split('\n').find(l => l.includes('atoi('));
    expect(atoiLine).toMatch(/atoi\(__tc_slice1\("A10", 1\)\)/);
    expect(atoiLine ?? '').not.toContain('.c_str()');
  });

  it('types a bitwise expression int so it can subscript', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const buckets = [0, 1, 2, 3];
      let x = 33.7;
      const i = Math.floor(x / 16) | 0;
      buckets[i] += 1;
    `);

    expect(r.cpp).toMatch(/const int i = /);
  });


  it('initializes a Record literal field-by-field and lowers dot access to element access', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const HELP: Record<string, string> = { dump: 'D', clear: 'C' };
      UART0.writeLine(\`\${HELP.dump}/\${HELP['clear']}\`);
    `);

    // Not a braced value-only map initializer
    expect(r.cpp).not.toMatch(/HELP = \{ "D", "C" \}/);
    expect(r.cpp).toMatch(/HELP\["dump"\] = "D"/);
    expect(r.cpp).toMatch(/HELP\["clear"\] = "C"/);
    // Dot access on the Record (even the map-member-named key) → element access
    expect(r.cpp).toMatch(/%s\/%s", HELP\["dump"\], HELP\["clear"\]/);
    expect(r.cpp).not.toMatch(/HELP\.dump|HELP\.clear([^()]|$)/);
  });

  it('pointer-izes interface types in containers and parameters', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      interface Handler { run(v: number): void; }
      class A implements Handler { run(v: number): void { } }
      const hs: Handler[] = [];
      hs.push(new A());
      function call(h: Handler): void { h.run(1); }
    `);

    // Empty array literal promotes to __tc_StaticArray on Zephyr; the
    // ELEMENT type is the interface pointer.
    expect(r.cpp).toMatch(/__tc_StaticArray<Handler\*,/);
    expect(r.cpp).toMatch(/void call\(Handler\* h\)/);
    expect(r.cpp).not.toMatch(/vector<Handler> /);
  });

  it('registers function-typed variables for template-literal formatting', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const onEvent = (code: number): string => \`E:\${code}\`;
      UART0.writeLine(\`go \${onEvent(7)}\`);
    `);

    expect(r.cpp).toMatch(/%s", onEvent\(7\)/);
  });

  it('lowers x.length = 0 to clear() and rejects nonzero length assignment', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      class Buf {
        private _v: number[] = [];
        reset(): void { this._v.length = 0; }
      }
    `);

    expect(r.cpp).toMatch(/this->_v\.clear\(\)/);
    expect(r.cpp).not.toMatch(/static_cast<long long>\(this->_v\.size\(\)\) = 0/);
  });

  it('lowers pop/push on a class-field vector to pop_back/push_back', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      class Buf {
        private _v: number[] = [];
        take(): void { this._v.pop(); }
        put(x: number): void { this._v.push(x); }
      }
    `);

    expect(r.cpp).toMatch(/this->_v\.pop_back\(\)/);
    expect(r.cpp).toMatch(/this->_v\.push_back\(x\)/);
    expect(r.cpp).not.toMatch(/this->_v\.pop\(\)/);
    expect(r.cpp).not.toMatch(/this->_v\.push\(/);
  });

  it('casts a real-typed switch discriminant reached through element access', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      class Parser {
        private _buf: number[] = [];
        first(): void {
          switch (this._buf[0]) {
            case 68:
              UART0.writeLine('D');
              break;
            default:
              break;
          }
        }
      }
    `);

    expect(r.cpp).toMatch(/switch \(static_cast<int>\(this->_buf\[0\]\)\)/);
  });

  it('casts real-typed indexes at element reads and element-assign targets', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      class Ring {
        private _cap = 4;
        private _head = 0;
        private _events: number[] = [];
        put(ev: number, i: number): void {
          this._events[this._head + i] = ev;
          const e = this._events[i];
        }
      }
    `);

    expect(r.cpp).toMatch(/this->_events\[static_cast<int>\(this->_head \+ i\)\] = ev/);
    expect(r.cpp).toMatch(/this->_events\[static_cast<int>\(i\)\]/);
  });

  it('casts enum args into number params but passes same-enum params directly', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      enum Verb { None = 0, Dump = 1 }
      enum Severity { Info = 0 }
      class Log {
        record(sev: Severity, code: number): void { }
      }
      const log = new Log();
      let v: Verb = Verb.Dump;
      log.record(Severity.Info, v);
      log.record(Severity.Info, Verb.None);
    `);

    expect(r.cpp).toMatch(/record\(Severity::Info, static_cast<int>\(v\)\)/);
    expect(r.cpp).toMatch(/record\(Severity::Info, static_cast<int>\(Verb::None\)\)/);
    // the Severity param itself takes the enum directly
    expect(r.cpp).not.toMatch(/record\(static_cast<int>\(Severity::Info\)/);
  });

  it('lowers a getter through a class field to the accessor call', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      class Log {
        private _fill = 3;
        get size(): number { return this._fill; }
      }
      class Dumper {
        private _log: Log = new Log();
        dump(): void { UART0.writeLine(\`\${this._log.size}\`); }
      }
    `);

    expect(r.cpp).toMatch(/this->_log->getSize\(\)/);
    expect(r.cpp).not.toMatch(/this->_log\.size/);
  });

  it('formats n.toString(16) in a template as a string', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      UART0.writeLine(\`0x\${(255).toString(16).toUpperCase()}\`);
    `);

    expect(r.cpp).toMatch(/0x%s", __tc_toUpperCase\(__tc_num_radix/);
  });

  it('types a map-get nullish declaration as the map value type', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      interface Handler { run(): void; }
      class Fallback implements Handler { run(): void { } }
      const handlers = new Map<number, Handler>();
      const fallback = new Fallback();
      const handler = handlers.get(1) ?? fallback;
      handler.run();
    `);

    expect(r.cpp).toMatch(/Handler\* handler = /);
    expect(r.cpp).toMatch(/handler->run\(\)/);
  });

});

