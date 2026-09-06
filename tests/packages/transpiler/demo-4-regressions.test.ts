// ---------------------------------------------------------------------------
// Regression tests for bugs surfaced by demo #4 (Forge).
//
// Each test pins a specific previously-broken shape so the fixes in the
// transpiler (expression-renderer, class-emitter, top-level-prep,
// snprintf-helpers) are not regressed.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, transpile, transpileNative } from '../../setup';

// ── A5: enum-typed struct-field arithmetic ───────────────────────────────────
//
// Before the fix, `item.rarity * 4` and `item.power + item.rarity` emitted the
// raw enum operand and failed at g++ ("no match for 'operator*'
// ('const Rarity' and 'int')"). The demo-#3 static_cast<int> fix only covered
// comparisons, not arithmetic on enum struct fields, and blanket-excluded "+".
describe('A5 — enum struct-field arithmetic is static_cast-wrapped', () => {
  it('wraps enum field in * and / arithmetic', () => {
    const result = transpile(`
      enum Rarity { Common = 1, Rare = 3 }
      interface Item { rarity: Rarity; power: number; }
      function score(item: Item): number {
        return item.power * item.rarity + item.rarity / 2;
      }
    `);
    // Both enum-field operands must be cast to int.
    expectCppContains(result, ['static_cast<int>(item.rarity)']);
  });

  it('wraps enum field in numeric + (not string concat)', () => {
    const result = transpile(`
      enum Rarity { Common = 1, Rare = 3 }
      interface Item { rarity: Rarity; power: number; }
      function boost(item: Item): number {
        return item.power + item.rarity;
      }
    `);
    // Numeric "+" must cast the enum operand; previously "+" was blanket-skipped.
    expectCppContains(result, ['static_cast<int>(item.rarity)']);
  });
});

// ── A7: member access through a struct field of class-pointer type (§4.5) ───
//
// Before the fix, `floor.monster.name` (where FloorState.monster is a Monster*
// field) emitted `floor.monster.name` (".") instead of `floor.monster->name`,
// failing at g++ ("request for member 'name' ... which is of pointer type").
// The IR-build-time isPointer detection only covered Identifier receivers.
describe('A7 — struct-field pointer access uses ->', () => {
  it('renders -> for member access through a class-pointer struct field', () => {
    const result = transpile(`
      class Monster {
        public name: string = "goblin";
      }
      interface FloorState { monster: Monster; }
      function nameOf(floor: FloorState): string {
        return floor.monster.name;
      }
    `);
    expectCppContains(result, ['floor_.monster->name']);
  });
});

// ── A8: getter read through a function parameter (§4.3) ────────────────────
//
// Before the fix, `hero.alive` inside a function whose parameter is `hero: Hero`
// emitted `hero->alive` instead of `hero->getAlive()`, failing at g++ ("'class
// Hero' has no member named 'alive'"). Only local var_decls were registered in
// varAccessorNames; parameters were skipped.
describe('A8 — getter call-site rewrite works through parameters', () => {
  it('rewrites a getter read on a pointer parameter to the accessor call', () => {
    const result = transpile(`
      class Hero {
        private _hp: int = 30;
        public get alive(): boolean { return this._hp > 0; }
      }
      function check(hero: Hero): boolean {
        return hero.alive;
      }
    `);
    // The call site must become hero->getAlive(), not hero->alive.
    expectCppContains(result, ['hero->getAlive()']);
    expect(result.cpp).not.toContain('hero->alive');
  });

  it('rewrites a getter read on a method parameter', () => {
    const result = transpile(`
      class Hero {
        private _hp: int = 30;
        public get alive(): boolean { return this._hp > 0; }
      }
      class Party {
        public check(other: Hero): boolean {
          return other.alive;
        }
      }
    `);
    expectCppContains(result, ['other->getAlive()']);
    expect(result.cpp).not.toContain('other->alive');
  });
});

// ── B1: top-level const reading a mutated top-level let (§6.1) ─────────────
//
// Before the fix, `const reached = descended;` at top level was hoisted as a
// file-scope global initialized BEFORE main(), freezing `reached` at descended's
// initial value. The demotion pass only demoted vars referencing
// runtime-classified names, missing mutable-but-compile-time reads.
describe('B1 — top-level const reading a mutated let stays in main()', () => {
  it('demotes a const that reads a top-level let mutated by an assignment', () => {
    const result = transpileNative(`
      let counter = 0;
      for (let i = 0; i < 3; i++) {
        counter = counter + 1;
      }
      const reached = counter;
      const _log1 = reached;
    `);
    // `reached` must NOT be a file-scope global initializer; it must be a
    // local inside main() so it reads counter's post-loop value. We assert it
    // is not present as a top-level `= counter;` declaration.
    const cpp = result.cpp;
    // The hoisted form would be a bare `long long reached = counter;` at file
    // scope (before main). The fixed form assigns inside main(). Check that
    // the declaration is not a file-scope global by ensuring it appears after
    // main()'s opening brace context — i.e. the global extern block does not
    // contain `reached = counter`.
    const mainIdx = cpp.indexOf('int main()');
    expect(mainIdx).toBeGreaterThan(-1);
    const beforeMain = cpp.slice(0, mainIdx);
    expect(beforeMain).not.toContain('reached = counter');
    expect(beforeMain).not.toContain('reached = descended');
  });
});

// ── B2: snprintf specifier for auto-local from a string field (§1.4) ───────
//
// Before the fix, `const name = loot.name; ... ${name}` (auto-deduced local
// from a string struct field) picked %ld because recordVariableType stored
// "auto" and the picker mapped "auto" → "%ld". The fix retains the initializer
// and re-infers.
describe('B2 — auto-local from string field picks %s', () => {
  it('uses %s for an auto local deduced from a string struct field', () => {
    const result = transpileNative(`
      interface Item { name: string; }
      function label(item: Item): string {
        const nm = item.name;
        return \`found \${nm}\`;
      }
    `);
    // The snprintf format for `nm` must be %s, not %ld/%lld/%d.
    expect(result.cpp).toMatch(/found %s/);
    expect(result.cpp).not.toMatch(/found %l[dd]/);
    expect(result.cpp).not.toMatch(/found %d/);
  });
});

// ── B3: literal % in a template literal is escaped to %% (§1.4) ────────────
//
// Before the fix, `hp=${hpPct}%` lowered to "hp=%.15g%" — a dangling
// conversion. The fix escapes literal % → %% in format-string text parts.
describe('B3 — literal % in template is escaped to %%', () => {
  it('doubles a trailing % in a template literal format string', () => {
    const result = transpileNative(`
      function pct(n: number): string {
        return \`\${n}%\`;
      }
    `);
    // The literal % must be escaped to %% in the snprintf format.
    expect(result.cpp).toMatch(/%%"/);
    expect(result.cpp).not.toMatch(/%.15g%"/);
  });
});
