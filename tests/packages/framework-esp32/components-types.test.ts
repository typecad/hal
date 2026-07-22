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

  it('reads builtin list verbatim (no path resolution)', () => {
    const cfg = { components: { builtin: ['esp_wifi', 'nvs_flash'] } };
    const r = resolveComponents(cfg, '/proj');
    expect(r.builtin).toEqual(['esp_wifi', 'nvs_flash']);
  });

  it('throws on malformed builtin (not a string array)', () => {
    const cfg = { components: { builtin: ['ok', 42] } };
    expect(() => resolveComponents(cfg, '/proj')).toThrow(/builtin/);
  });

  it('returns empty builtin when absent', () => {
    const cfg = { components: { managed: { 'a/b': '^1.0' } } };
    const r = resolveComponents(cfg, '/proj');
    expect(r.builtin).toEqual([]);
  });

  it('defaults psram to false when absent', () => {
    const r = resolveComponents(undefined, '/proj');
    expect(r.psram).toBe(false);
  });

  it('reads psram: "opi" verbatim', () => {
    const cfg = { psram: 'opi' as const };
    const r = resolveComponents(cfg, '/proj');
    expect(r.psram).toBe('opi');
  });

  it('reads psram: "quad" verbatim', () => {
    const cfg = { psram: 'quad' as const };
    const r = resolveComponents(cfg, '/proj');
    expect(r.psram).toBe('quad');
  });

  it('accepts psram: false explicitly', () => {
    const cfg = { psram: false };
    const r = resolveComponents(cfg, '/proj');
    expect(r.psram).toBe(false);
  });

  it('throws on malformed psram (not opi/quad/false)', () => {
    const cfg = { psram: 'octal' };
    expect(() => resolveComponents(cfg, '/proj')).toThrow(/psram/);
  });
});
