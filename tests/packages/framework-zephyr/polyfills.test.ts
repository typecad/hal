import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

// Zephyr is a no-STL target (hasVector/hasString = false), so array/string
// literals and string methods lower to __tc_StaticArray / __tc_* helpers. The
// strategy must supply STL-free definitions for both — there is no shared
// runtime fallback (the pipeline sources all polyfills from
// generateNativePolyfills). These tests lock that contract in.

describe('ZephyrStrategy no-STL polyfills', () => {
  const s = new ZephyrStrategy();

  it('declares string_methods + static_array in nativePolyfills', () => {
    const ids = s.nativePolyfills();
    expect(ids.has('string_methods')).toBe(true);
    expect(ids.has('static_array')).toBe(true);
  });

  it('emits a STL-free __tc_StaticArray template (static_array polyfill)', () => {
    const polys = s.generateNativePolyfills(undefined, undefined);
    const sa = polys.find((p) => p.id === 'static_array');
    expect(sa).toBeDefined();
    const text = (sa?.helperFunctions ?? []).join('\n');
    expect(text).toContain('__tc_StaticArray');
    expect(text).toContain('void push(T val)');
    expect(text).toContain('__TC_STATIC_ARRAY_DEFINED'); // idempotent guard
    // STL-free: must not pull in <vector>.
    expect(sa?.requiredIncludes ?? []).not.toContain('<vector>');
  });

  it('emits the __tc_* string helpers (string_methods polyfill)', () => {
    const polys = s.generateNativePolyfills(undefined, undefined);
    const sm = polys.find((p) => p.id === 'string_methods');
    expect(sm).toBeDefined();
    const text = (sm?.helperFunctions ?? []).join('\n');
    expect(text).toContain('__tc_toUpperCase');
    expect(text).toContain('__tc_endsWith');
    expect(text).toContain('__tc_substring2');
    expect(text).toContain('__tc_replace');
    expect(text).toContain('__tc_charCodeAt');
    // Minimal-libc friendly: case conv is inline (no <cctype>); <string> and
    // <vector> ride along for the std::string receiver overloads + __tc_split.
    expect(sm?.requiredIncludes).toEqual(['<cstring>', '<string>', '<vector>']);
  });

  it('string helpers are const char*-primary (std::string overloads added)', () => {
    const polys = s.generateNativePolyfills(undefined, undefined);
    const text = (polys.find((p) => p.id === 'string_methods')?.helperFunctions ?? []).join('\n');
    expect(text).toContain('const char* __tc_toUpperCase(const char* s)');
    // The std::string forms are OVERLOADS delegating to the C-string
    // primaries — a std::string receiver (a split() element) compiles against
    // the same lowering.
    expect(text).toMatch(/inline std::string __tc_toUpperCase\(const std::string& s\)/);
  });

  it('defines __tc_split and std::string receiver overloads', () => {
    // .split()'s call-path rewrite is not wired on Zephyr yet, but the
    // definitions it will target already ship (bench-supervisor demo).
    const polys = s.generateNativePolyfills(undefined, undefined);
    const text = (polys.find((p) => p.id === 'string_methods')?.helperFunctions ?? []).join('\n');
    expect(text).toContain('__tc_split(const char* s, const char* delim)');
    expect(text).toContain('__tc_split(const std::string& s, const char* delim)');
    expect(text).toContain('__tc_toUpperCase(const std::string& s)');
  });

  it('marks every polyfill function definition inline (multi-TU safe)', () => {
    // The block lands in per-module headers; two TUs including it linked
    // with multiple-definition errors before every definition went inline
    // (bench-supervisor demo finding).
    const polys = s.generateNativePolyfills(undefined, undefined);
    const text = (polys.find((p) => p.id === 'string_methods')?.helperFunctions ?? []).join('\n');
    const defLines = text.split('\n').filter((l) => /^inline (bool|const char\*|int|std::vector<std::string>) __tc_/.test(l.trim()));
    expect(defLines.length).toBeGreaterThanOrEqual(10);
    for (const line of defLines) {
      expect(line.trim().startsWith('inline ')).toBe(true);
    }
  });

  it('rotates enough result slots for one printf argument list', () => {
    // The helpers return pointers into a rotating static ring. A status line
    // like `t=${a.toFixed(2)} avg=${b.toFixed(2)} set=${c.toFixed(1)}`
    // evaluates ALL its __tc_toFixed calls BEFORE snprintf runs — with two
    // slots the third call overwrote the first result and the line printed
    // setpoint for the temperature. The ring must span a full argument list
    // (CUTTLEFISH_STR_SLOTS, power of two for the mask advance).
    const polys = s.generateNativePolyfills(undefined, undefined);
    const text = (polys.find((p) => p.id === 'string_methods')?.helperFunctions ?? []).join('\n');
    expect(text).toContain('#define CUTTLEFISH_STR_SLOTS 8');
    expect(text).not.toContain('buf[2][CUTTLEFISH_STR_BUF_SIZE]');
    expect(text).not.toContain('slot ^= 1');
  });

  it('normalizeRawExpression lowers string methods to __tc_* helpers', () => {
    // The rewrite is what makes a const char* receiver's method calls compile
    // (the polyfill only supplies the definitions). includes/startsWith route
    // through the __tc_* helpers now (the old inline strstr/strncmp forms
    // could not accept a std::string receiver).
    expect(s.normalizeRawExpression('s.toUpperCase()')).toBe('__tc_toUpperCase(s)');
    expect(s.normalizeRawExpression('s.toLowerCase()')).toBe('__tc_toLowerCase(s)');
    expect(s.normalizeRawExpression('s.trim()')).toBe('__tc_trim(s)');
    expect(s.normalizeRawExpression('s.includes("x")')).toBe('__tc_includes(s, "x")');
    expect(s.normalizeRawExpression('s.startsWith("x")')).toBe('__tc_startsWith(s, "x")');
    expect(s.normalizeRawExpression('s.substring(0, 3)')).toBe('__tc_substring2(s, 0, 3)');
  });
});
