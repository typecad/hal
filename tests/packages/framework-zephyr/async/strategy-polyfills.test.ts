import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';

describe('ZephyrStrategy polyfill wiring', () => {
  const s = new ZephyrStrategy();

  it('declares timer_methods + async_runtime in nativePolyfills()', () => {
    const ids = s.nativePolyfills();
    expect(ids.has('timer_methods')).toBe(true);
    expect(ids.has('async_runtime')).toBe(true);
    expect(ids.has('cuttlefish_halt')).toBe(true);
  });

  it('emits cuttlefish_halt always', () => {
    const irs = s.generateNativePolyfills(undefined, undefined);
    expect(irs.map((p) => p.id)).toContain('cuttlefish_halt');
  });

  it('emits timer_methods when timerCallCount > 0', () => {
    const ctx = { analysis: { timerCallCount: 3 } } as any;
    const irs = s.generateNativePolyfills(undefined, ctx);
    const timer = irs.find((p) => p.id === 'timer_methods');
    expect(timer).toBeDefined();
    expect(timer!.helperStructs[0]).toContain('k_timer');
  });

  it('omits timer_methods when timerCallCount is 0', () => {
    const ctx = { analysis: { timerCallCount: 0 } } as any;
    const irs = s.generateNativePolyfills(undefined, ctx);
    expect(irs.map((p) => p.id)).not.toContain('timer_methods');
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

  it('async runtime config reports promise runtime + timers', () => {
    const cfg = s.getAsyncRuntimeConfig();
    expect(cfg.hasPromiseRuntime).toBe(true);
    expect(cfg.hasTimers).toBe(true);
  });

  it('asyncLoopInjection drives each task via .run() + pumps microtasks (no native-timer poll)', () => {
    // Pass real task names — loop() must call <task>.run() per frame or the
    // async state machines never advance (the demo "freezes at banner" bug).
    const lines = s.asyncLoopInjection(
      ['networkTask', 'watchLinkTask', 'heartbeatTask'],
      { hasPromiseRuntime: true, hasTimers: true } as any,
    );
    expect(lines).toContain('cuttlefish_pump_microtasks();');
    expect(lines).toContain('networkTask.run();');
    expect(lines).toContain('watchLinkTask.run();');
    expect(lines).toContain('heartbeatTask.run();');
    // Timers are native k_timer — there is NO __tc_timer_runtime.run() poll.
    expect(lines.some((l) => l.includes('__tc_timer_runtime'))).toBe(false);
  });

  it('asyncLoopInjection emits .run() for tasks even without a promise runtime', () => {
    // The static state-machine runtime drives tasks via .run() regardless of
    // whether the promise/microtask pump is active.
    const lines = s.asyncLoopInjection(['networkTask'], { hasPromiseRuntime: false, hasTimers: false } as any);
    expect(lines).toContain('networkTask.run();');
    expect(lines).not.toContain('cuttlefish_pump_microtasks();');
  });
});
