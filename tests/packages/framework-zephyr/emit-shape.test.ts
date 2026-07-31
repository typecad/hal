import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

describe('ZephyrStrategy emit-shape signatures', () => {
  const s = new ZephyrStrategy();

  it('overrideBaseName: npm package → passthrough originalBaseName', () => {
    expect(s.overrideBaseName('foo', 'out', true, true)).toBe('foo');
  });

  it('overrideBaseName: entry file (non-npm) → outDirBaseName', () => {
    expect(s.overrideBaseName('foo', 'main', true, false)).toBe('main');
  });

  it('overrideBaseName: non-entry (non-npm) → originalBaseName', () => {
    expect(s.overrideBaseName('foo', 'main', false, false)).toBe('foo');
  });

  it('effectiveEmitMode: passthrough for both npm and app (Zephyr always .cpp)', () => {
    expect(s.effectiveEmitMode('split', false)).toBe('split');
    expect(s.effectiveEmitMode('split', true)).toBe('split');
  });
});
