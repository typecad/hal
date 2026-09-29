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

  it('string helpers are std::string-primary (one string model)', () => {
    const polys = s.generateNativePolyfills(undefined, undefined);
    const text = (polys.find((p) => p.id === 'string_methods')?.helperFunctions ?? []).join('\n');
    expect(text).toContain('std::string __tc_toUpperCase(const std::string& s)');
    expect(text).toContain('std::string __tc_toFixed(double val, int digits)');
    // No rotating static result buffers remain — every producer returns an
    // owned std::string, deleting the ring-aliasing bug class.
    expect(text).not.toMatch(/static char buf\[/);
    expect(text).not.toContain('CUTTLEFISH_STR_SLOTS');
  });

  it('defines __tc_split over std::string', () => {
    // .split()'s call-path rewrite is not wired on Zephyr yet, but the
    // definition it will target already ships (bench-supervisor demo).
    const polys = s.generateNativePolyfills(undefined, undefined);
    const text = (polys.find((p) => p.id === 'string_methods')?.helperFunctions ?? []).join('\n');
    expect(text).toContain('__tc_split(const std::string& s, const char* delim)');
  });

  it('marks every polyfill function definition inline (multi-TU safe)', () => {
    // The block lands in per-module headers; two TUs including it linked
    // with multiple-definition errors before every definition went inline
    // (bench-supervisor demo finding).
    const polys = s.generateNativePolyfills(undefined, undefined);
    const text = (polys.find((p) => p.id === 'string_methods')?.helperFunctions ?? []).join('\n');
    const defLines = text.split('\n').filter((l) => /^inline (bool|std::string|int|std::vector<std::string>) __tc_/.test(l.trim()));
    expect(defLines.length).toBeGreaterThanOrEqual(10);
  });

  it('returns by value — no static result rings anywhere', () => {
    // The historical invariant this replaces: helpers returned const char*
    // into rotating static rings, which aliased when more results were live
    // than slots. By-value std::string returns remove the ceiling entirely;
    // this pins that no ring ever comes back.
    const polys = s.generateNativePolyfills(undefined, undefined);
    const text = (polys.find((p) => p.id === 'string_methods')?.helperFunctions ?? []).join('\n');
    expect(text).not.toMatch(/static char buf\[/);
    expect(text).not.toMatch(/uint8_t slot/);
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
