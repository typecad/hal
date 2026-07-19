import { describe, it, expect } from 'vitest';
import { shouldReconfigure } from '../../../packages/framework-esp32/src/toolchain/compile';

describe('shouldReconfigure', () => {
  it('returns true when deps hash differs', () => {
    expect(shouldReconfigure(true, false)).toBe(true); // (depsChanged, sdkconfigExists)
  });

  it('returns false when deps hash unchanged and sdkconfig exists', () => {
    expect(shouldReconfigure(false, true)).toBe(false);
  });

  it('returns true when sdkconfig is missing even if hash matches', () => {
    // First-run case: no sdkconfig yet → set-target handles config, but we
    // still need reconfigure to fetch components.
    expect(shouldReconfigure(false, false)).toBe(true);
  });
});
