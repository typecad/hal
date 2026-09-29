// ---------------------------------------------------------------------------
// structural-invariants.test.ts — tests for the consolidated structural
// machinery introduced after the two demo rounds:
//
//   1. helper-return-types — the single registry for `__tc_*` return types.
//      Guards the "every helper has exactly one entry" completeness contract
//      (num_radix shipped in the polyfills but was missing from every
//      inference arm — printed a pointer through %d).
//   2. map-key-cast — the ONE shared enum-key cast implementation.
//   3. header-linkage-check — the post-emit ODR/visibility invariants.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { HELPER_RETURN_TYPES, helperReturnTypeForText, helperNameFromText } from '../../../packages/cuttlefish/src/api/shared/helper-return-types';
import { POLYFILL_HELPER_MAP } from '../../../packages/cuttlefish/src/api/shared/polyfill-helper-registry';
import { STRING_METHODS } from '../../../packages/cuttlefish/src/api/shared/string-method-registry';
import { transpileZephyrStrategy } from '../../setup';
import { findHeaderLinkageIssues } from '../../../packages/cuttlefish/src/emit/emitters/header-linkage-check';

describe('helper-return-types registry', () => {
  it('has an entry for every helper the polyfill registry can emit', () => {
    const known = new Set<string>([
      ...Object.values(POLYFILL_HELPER_MAP).flat(),
      '__tc_fmt_num_buf', // shim-internal, not a lowering target
    ]);
    const missing: string[] = [];
    for (const name of known) {
      // Only string/formatting/math helpers are classified here; array and
      // map helpers return element-dependent types and are out of scope.
      if (/^(__tc_(?:toUpperCase|toLowerCase|trim|replace|charAt|charCodeAt|substring|slice|padStart|padEnd|repeat|split|includes|indexOf|lastIndexOf|endsWith|startsWith|toFixed|jsonStringify|join|num_radix|random))/.test(name)) {
        if (!(name in HELPER_RETURN_TYPES)) missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it('covers every string-method helper the registry lists', () => {
    const missing: string[] = [];
    for (const spec of STRING_METHODS) {
      if (!(spec.helper in HELPER_RETURN_TYPES)) missing.push(spec.helper);
    }
    expect(missing).toEqual([]);
  });

  it('classifies call text by the leading helper name', () => {
    expect(helperReturnTypeForText('__tc_toFixed(v, 2)')).toBe('std::string');
    expect(helperReturnTypeForText('__tc_num_radix(255, 16)')).toBe('std::string');
    expect(helperReturnTypeForText('__tc_startsWith(s, "x")')).toBe('bool');
    expect(helperReturnTypeForText('__tc_charCodeAt(s, 0)')).toBe('int');
    expect(helperReturnTypeForText('std::floor(x)')).toBeUndefined();
    expect(helperNameFromText('(not a helper)')).toBeUndefined();
  });
});

describe('reserved-name variable consistency', () => {
  it('escapes declaration AND every reference identically', () => {
    const r = transpileZephyrStrategy(`
      class ELog { record(n: number): void { } get size(): number { return 1; } }
      const log = new ELog();
      log.record(1);
      function use(): void { log.record(2); const n = log.size; }
    `);
    // The declaration escapes (log_) ...
    expect(r.cpp).toMatch(/ELog\* log_/);
    // ... and so does every reference — statement, function-body call,
    // and getter access — never the raw libc name.
    expect(r.cpp).toMatch(/log_->record\(1\)/);
    expect(r.cpp).toMatch(/log_->record\(2\)/);
    expect(r.cpp).toMatch(/log_->getSize\(\)/);
    expect(r.cpp).not.toMatch(/[^\w_]log->/);
  });

  it.fails('a top-level instance declaration after a class declaration is captured into the class body (known bug)', () => {
    // `new LocalCls()` AFTER the class declaration in the same file gets
    // emitted as a MEMBER of that class instead of a top-level definition —
    // proven pre-existing (fires on the committed baseline too). Pinned as
    // it.fails until the class-emitter capture is fixed.
    const r = transpileZephyrStrategy(`
      class EventLog { record(n: number): void { } }
      const elog = new EventLog(16);
      const hist = 3;
    `);
    // The declaration must be a top-level definition, not a class member.
    const inClass = r.cpp.split('class EventLog')[1]?.split('};')[0] ?? '';
    expect(inClass).not.toContain('new EventLog');
    expect(r.cpp).toMatch(/^EventLog\* elog = /m);
  });
});


describe('header-linkage-check', () => {
  it('flags a non-inline free function definition in a header', () => {
    const lines = [
      '#pragma once',
      'inline int fine(int x) { return x; }',
      'int notInline(int y) { return y; }',
    ];
    const issues = findHeaderLinkageIssues(lines);
    expect(issues).toEqual([{ line: 2, kind: 'non-inline-definition', symbol: 'notInline' }]);
  });

  it('accepts inline and template definitions', () => {
    const lines = [
      'inline const char* ok1(int v) { return "x"; }',
      'template<typename T> T ok2(T v) { return v; }',
      'struct Holder { int a; };',
    ];
    expect(findHeaderLinkageIssues(lines)).toEqual([]);
  });

  it('flags a prototype after the classes when an inline body calls it', () => {
    const lines = [
      'class Log {',
      'public:',
      '  void line() { label(3); }',
      '};',
      'const char* label(double n);',
    ];
    const issues = findHeaderLinkageIssues(lines);
    expect(issues).toEqual([{ line: 4, kind: 'late-prototype', symbol: 'label' }]);
  });

  it('keeps post-class prototypes nothing inline calls (ISR shims)', () => {
    const lines = [
      'class Log {',
      'public:',
      '  void line() { }',
      '};',
      'void main_isr_0();',
    ];
    expect(findHeaderLinkageIssues(lines)).toEqual([]);
  });

  it('a friend declaration is visibility, not a call', () => {
    // The ISR shims are friend-declared inside the class and prototyped
    // after it — legal, and must not trip the late-prototype rule.
    const lines = [
      'class Sink {',
      'public:',
      '  friend void main_isr_0();',
      '  void run() { work(); }',
      '};',
      'void main_isr_0();',
      'void work();',
    ];
    const issues = findHeaderLinkageIssues(lines);
    expect(issues).toContainEqual({ line: 6, kind: 'late-prototype', symbol: 'work' });
    expect(issues).not.toContainEqual(expect.objectContaining({ symbol: 'main_isr_0' }));
  });

  it('keeps a template prototype after classes', () => {
    const lines = [
      'class Log {',
      'public:',
      '  void line() { }',
      '};',
      'template<typename T>',
      'T pick(T v);',
    ];
    expect(findHeaderLinkageIssues(lines)).toEqual([]);
  });

  it('is quiet on a healthy hoisted-prototype header', () => {
    const lines = [
      '#pragma once',
      'inline const char* __tc_trim(const char* s) { return s; }',
      'const char* label(double n);',
      'class Log {',
      'public:',
      '  void line() { label(3); }',
      '};',
    ];
    expect(findHeaderLinkageIssues(lines)).toEqual([]);
  });
});
