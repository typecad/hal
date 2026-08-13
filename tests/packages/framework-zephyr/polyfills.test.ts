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
    // Minimal-libc friendly: only <cstring> (no <cctype> — case conv is inline).
    expect(sm?.requiredIncludes).toEqual(['<cstring>']);
  });

  it('string helpers are const char*-signature (no std::string)', () => {
    const polys = s.generateNativePolyfills(undefined, undefined);
    const text = (polys.find((p) => p.id === 'string_methods')?.helperFunctions ?? []).join('\n');
    expect(text).toContain('const char* __tc_toUpperCase(const char* s)');
    expect(text).not.toMatch(/std::string/);
  });

  it('normalizeRawExpression lowers string methods to __tc_* helpers / inline ops', () => {
    // The rewrite is what makes a const char* receiver's method calls compile
    // (the polyfill only supplies the definitions). Mirrors framework-arduino.
    expect(s.normalizeRawExpression('s.toUpperCase()')).toBe('__tc_toUpperCase(s)');
    expect(s.normalizeRawExpression('s.toLowerCase()')).toBe('__tc_toLowerCase(s)');
    expect(s.normalizeRawExpression('s.trim()')).toBe('__tc_trim(s)');
    expect(s.normalizeRawExpression('s.includes("x")')).toBe('(strstr(s, "x") != NULL)');
    expect(s.normalizeRawExpression('s.startsWith("x")')).toBe('(strncmp(s, "x", strlen("x")) == 0)');
    expect(s.normalizeRawExpression('s.substring(0, 3)')).toBe('__tc_substring2(s, 0, 3)');
  });
});
