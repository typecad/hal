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

  // ── main()-based entrypoint (no Arduino setup()/loop() pair) ────────────

  it('entrypoint is main(), with no synthesized loop()', () => {
    expect(s.entrypointFunctionName()).toBe('main');
    expect(s.requiresLoopFunction()).toBe(false);
  });

  it('main return type is int; the async driver function is main', () => {
    expect(s.mapReturnType('main', 'void')).toBe('int');
    expect(s.asyncDriverFunctionName()).toBe('main');
  });

  it('forwardDeclarationExclusions is empty (no extern-bridged entrypoints)', () => {
    expect(s.forwardDeclarationExclusions()).toEqual([]);
  });

  it('asyncLoopInjection self-wraps a scheduler loop when no UI is mounted', () => {
    const lines = s.asyncLoopInjection(['task1'], { hasPromiseRuntime: true, hasTimers: true } as any);
    expect(lines[0]).toBe('for (;;) {');
    expect(lines).toContain('  cuttlefish_pump_microtasks();');
    expect(lines).toContain('  task1.run();');
    expect(lines).toContain('  k_msleep(1);');
    expect(lines[lines.length - 1]).toBe('}');
  });

  it('hostEventLoop yields a forever scheduler loop for UI builds', () => {
    const loop = s.hostEventLoop();
    expect(loop).not.toBeNull();
    expect(loop!.flagName).toBe('__tc_zephyr_event_loop');
    expect(loop!.continueCondition).toBe('__tc_zephyr_event_loop');
    expect(loop!.postIteration).toBe('k_msleep(1);');
  });
});
