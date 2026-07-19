import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  resolveComponents,
  type Esp32FrameworkData,
} from '../../../packages/framework-esp32/src/components/types';

describe('resolveComponents', () => {
  it('returns empty managed/local when frameworkConfig is undefined', () => {
    const r = resolveComponents(undefined, '/proj');
    expect(r.managed).toEqual({});
    expect(r.local).toEqual([]);
  });

  it('reads managed record verbatim', () => {
    const cfg = { components: { managed: { 'espressif/esp_wifi': '^1.0' } } };
    const r = resolveComponents(cfg, '/proj');
    expect(r.managed).toEqual({ 'espressif/esp_wifi': '^1.0' });
    expect(r.local).toEqual([]);
  });

  it('resolves local paths relative to projectRoot', () => {
    const cfg = { components: { local: ['./components/foo', './components/bar'] } };
    const r = resolveComponents(cfg, '/proj');
    expect(r.local).toEqual([
      path.resolve('/proj', 'components/foo'),
      path.resolve('/proj', 'components/bar'),
    ]);
  });

  it('leaves absolute local paths as-is', () => {
    const abs = path.resolve('/abs/component');
    const cfg = { components: { local: [abs] } };
    const r = resolveComponents(cfg, '/proj');
    expect(r.local).toEqual([abs]);
  });

  it('throws on malformed managed (not a record of string→string)', () => {
    const cfg = { components: { managed: { 'foo': 123 } } };
    expect(() => resolveComponents(cfg, '/proj')).toThrow(/managed/);
  });

  it('throws on malformed local (not a string array)', () => {
    const cfg = { components: { local: ['ok', 42] } };
    expect(() => resolveComponents(cfg, '/proj')).toThrow(/local/);
  });
});
