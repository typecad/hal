import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';

describe('ZephyrStrategy polyfill wiring', () => {
  const s = new ZephyrStrategy();

  it('declares async_runtime (and no timer queue) in nativePolyfills()', () => {
    const ids = s.nativePolyfills();
    expect(ids.has('async_runtime')).toBe(true);
    expect(ids.has('cuttlefish_halt')).toBe(true);
    // Periodic work is a Thread (k_thread) or Counter (hardware timer) —
    // there is no cooperative timer polyfill on Zephyr.
    expect(ids.has('timer_methods')).toBe(false);
  });

  it('emits cuttlefish_halt always', () => {
    const irs = s.generateNativePolyfills(undefined, undefined);
    expect(irs.map((p) => p.id)).toContain('cuttlefish_halt');
  });

  it('emits async_runtime when the program has an async function', () => {
    const program = { functions: [{ isAsync: true }] } as any;
    const irs = s.generateNativePolyfills(program, undefined);
    const asyncIr = irs.find((p) => p.id === 'async_runtime');
    expect(asyncIr).toBeDefined();
    expect(asyncIr!.helperStructs[0]).toContain('typecad_async_static');
  });

  it('omits async_runtime when the program has no async functions', () => {
    const program = { functions: [{ isAsync: false }] } as any;
    const irs = s.generateNativePolyfills(program, undefined);
    expect(irs.map((p) => p.id)).not.toContain('async_runtime');
  });

  it('async runtime config reports promise runtime (timers are Threads/Counters)', () => {
    const cfg = s.getAsyncRuntimeConfig();
    expect(cfg.hasPromiseRuntime).toBe(true);
    expect(cfg.hasTimers).toBe(false);
  });

  it('asyncLoopInjection drives each task via .run() + pumps microtasks (no native-timer poll)', () => {
    // Pass real task names — the scheduler loop in main() must call
    // <task>.run() per frame or the async state machines never advance (the
    // demo "freezes at banner" bug). Without a mounted UI the injection
    // self-wraps its own for(;;) scheduler loop (main() runs once).
    const lines = s.asyncLoopInjection(
      ['networkTask', 'watchLinkTask', 'heartbeatTask'],
      { hasPromiseRuntime: true, hasTimers: false } as any,
    );
    expect(lines[0]).toBe('for (;;) {');
    expect(lines).toContain('  cuttlefish_pump_microtasks();');
    expect(lines).toContain('  networkTask.run();');
    expect(lines).toContain('  watchLinkTask.run();');
    expect(lines).toContain('  heartbeatTask.run();');
    expect(lines).toContain('  k_msleep(1);');
    // There is NO __tc_timer_runtime.run() poll.
    expect(lines.some((l) => l.includes('__tc_timer_runtime'))).toBe(false);
  });

  it('asyncLoopInjection emits .run() for tasks even without a promise runtime', () => {
    // The static state-machine runtime drives tasks via .run() regardless of
    // whether the promise/microtask pump is active.
    const lines = s.asyncLoopInjection(['networkTask'], { hasPromiseRuntime: false, hasTimers: false } as any);
    expect(lines).toContain('  networkTask.run();');
    expect(lines).not.toContain('  cuttlefish_pump_microtasks();');
    expect(lines).not.toContain('cuttlefish_pump_microtasks();');
  });
});
