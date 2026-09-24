// ---------------------------------------------------------------------------
// trace-preflight.test.ts — the agent-safety half of capture: fail fast on
// an untraced build (exit 2 + remedy, never a silent empty capture), the
// gates-file loader, and the lone-port auto-pick.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isTracedBuildConfig, findBuildConfig, preflightTracedBuild,
  parseGatesFile, pickAutoPort,
} from '../../../packages/cuttlefish/src/trace/preflight';

describe('isTracedBuildConfig', () => {
  it('requires both sampler symbols set to y', () => {
    expect(isTracedBuildConfig('CONFIG_THREAD_RUNTIME_STATS=y\nCONFIG_THREAD_MONITOR=y\n')).toBe(true);
    expect(isTracedBuildConfig('CONFIG_THREAD_RUNTIME_STATS=y\n# CONFIG_THREAD_MONITOR is not set\n')).toBe(false);
    // A commented-out mention must not satisfy the check.
    expect(isTracedBuildConfig('# CONFIG_THREAD_RUNTIME_STATS=y\nCONFIG_THREAD_MONITOR=y\n')).toBe(false);
  });
});

describe('findBuildConfig / preflightTracedBuild', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'trace-pre-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const traced = 'CONFIG_THREAD_RUNTIME_STATS=y\nCONFIG_THREAD_MONITOR=y\nCONFIG_GPIO=y\n';
  const untraced = 'CONFIG_GPIO=y\n';

  it('finds src/out/build (the scaffold layout) and reports traced', () => {
    const cfg = join(dir, 'src', 'out', 'build', 'zephyr');
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, '.config'), traced);
    expect(findBuildConfig(dir)).toContain('src');
    expect(preflightTracedBuild(dir)).toEqual({ status: 'traced', configPath: join(cfg, '.config') });
  });

  it('reports untraced when the symbols are absent', () => {
    const cfg = join(dir, 'build', 'zephyr');
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, '.config'), untraced);
    expect(preflightTracedBuild(dir).status).toBe('untraced');
  });

  it('returns no-build when nothing exists (capture proceeds with a warning)', () => {
    expect(preflightTracedBuild(dir).status).toBe('no-build');
  });

  it('walks nested build dirs but skips node_modules', () => {
    const cfg = join(dir, 'fw', 'build', 'zephyr');
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, '.config'), traced);
    mkdirSync(join(dir, 'node_modules', 'pkg', 'build', 'zephyr'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg', 'build', 'zephyr', '.config'), untraced);
    expect(findBuildConfig(dir)).toBe(join(cfg, '.config'));
  });
});

describe('parseGatesFile', () => {
  it('accepts { gates: [...] } and a bare array', () => {
    expect(parseGatesFile('{"gates":["cpu-avg:main<=50"]}', 'g.json')).toEqual(['cpu-avg:main<=50']);
    expect(parseGatesFile('["frame-max<=20"]', 'g.json')).toEqual(['frame-max<=20']);
  });

  it('rejects non-JSON and wrong shapes with context', () => {
    expect(() => parseGatesFile('{', 'g.json')).toThrow(/Cannot read gates file/);
    expect(() => parseGatesFile('{"threshold": 5}', 'g.json')).toThrow(/must be a JSON array/);
    expect(() => parseGatesFile('[1, 2]', 'g.json')).toThrow(/must be a JSON array/);
  });
});

describe('pickAutoPort', () => {
  it('picks only an unambiguous single port', () => {
    expect(pickAutoPort(['COM9'])).toBe('COM9');
    expect(pickAutoPort([])).toBeUndefined();
    expect(pickAutoPort(['COM9', 'COM1'])).toBeUndefined();
  });
});
