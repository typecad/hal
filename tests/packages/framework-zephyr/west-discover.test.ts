import { describe, expect, it, beforeEach } from 'vitest';
import {
  discoverWest,
  resetWestDiscoveryCache,
  discoverFromWellKnown,
  wellKnownWorkspaces,
  isZephyrBase,
} from '../../../packages/framework-zephyr/src/toolchain/west-discover.js';
import { westSpawn } from '../../../packages/framework-zephyr/src/toolchain/west-spawn.js';

describe('framework-zephyr west discovery', () => {
  beforeEach(() => {
    resetWestDiscoveryCache();
  });

  it('isZephyrBase rejects non-Zephyr dirs', () => {
    expect(isZephyrBase('')).toBe(false);
    expect(isZephyrBase('/nonexistent')).toBe(false);
    expect(isZephyrBase(process.cwd())).toBe(false); // the typecode repo root
  });

  it('wellKnownWorkspaces includes the canonical zephyrproject layout', () => {
    const ws = wellKnownWorkspaces();
    // Every platform's well-known list should name a zephyrproject dir.
    expect(ws.some((w) => w.includes('zephyrproject'))).toBe(true);
  });

  it('discoverFromWellKnown tolerates a missing/injected workspace list', () => {
    // An empty injected list finds nothing rather than crashing.
    expect(discoverFromWellKnown([])).toBeNull();
    // A bogus path finds nothing.
    expect(discoverFromWellKnown(['/definitely/not/here'])).toBeNull();
  });

  it('discoverWest returns a usable install or null (never throws)', () => {
    // On a machine with Zephyr installed this resolves an install; on CI
    // without west it returns null. Either is valid — the contract is "never
    // throw". The real-machine smoke test is the demos/zephyr-blink `west build`.
    let install: ReturnType<typeof discoverWest>;
    expect(() => {
      install = discoverWest();
    }).not.toThrow();
    // When an install IS found, it must carry the fields westSpawn needs.
    if (install!) {
      expect(install.mode === 'launcher' || install.mode === 'module').toBe(true);
      if (install.mode === 'launcher') {
        expect(install.westExecutable).toBeTruthy();
      } else {
        expect(install.pythonExecutable).toBeTruthy();
      }
    }
  });

  it('westSpawn throws an actionable error when no west is discoverable', () => {
    // Force discovery to miss by clearing the cache and pointing well-known
    // paths at nothing. We can't fully neutralize PATH/system-python in a unit
    // test, so this asserts the error PATH only when discovery genuinely fails
    // — otherwise it asserts the invocation shape. The contract that matters
    // is: westSpawn never silently produces a broken invocation.
    resetWestDiscoveryCache();
    let threw = false;
    let invocation: ReturnType<typeof westSpawn> | null = null;
    try {
      invocation = westSpawn(['--version'], { encoding: 'utf-8' });
    } catch (e) {
      threw = true;
      expect((e as Error).message).toContain('west');
      expect((e as Error).message).toContain('ZEPHYR_BASE');
    }
    if (!threw && invocation) {
      // A real install was found — verify the invocation is well-formed.
      expect(invocation.command).toBeTruthy();
      expect(invocation.args.length).toBeGreaterThan(0);
      if (invocation.install.mode === 'module') {
        expect(invocation.args[0]).toBe('-m');
        expect(invocation.args[1]).toBe('west');
      }
    }
  });
});
