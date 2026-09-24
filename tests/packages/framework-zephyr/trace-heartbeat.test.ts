import { describe, it, expect } from 'vitest';
import { transpile } from '../../setup';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import { traceHeartbeatLines, uiFrameTraceLines } from '../../../packages/framework-zephyr/src/lowering/trace';

// zephyr.trace.enabled in typecad-hal.config.ts emits a self-starting
// runtime-stats sampler into the ENTRY TU's shim header: a k_work_delayable
// that samples per-thread execution cycles + stack usage every intervalMs
// and prints [TR: lines on the console. The whole block gates on
// CUTTLEFISH_ENTRY_TU so a split-file TU never carries a second SYS_INIT
// (a duplicate would double every heartbeat), and on the Kconfig symbols
// the scaffold turns on with it (a user override compiles the sampler out
// rather than failing the link).
describe('ZephyrStrategy trace heartbeat emission (zephyr.trace)', () => {
  const baseOpts = () => ({
    strategy: new ZephyrStrategy(),
    target: 'zephyr',
    platformContext: { frameworkData: { target: 'xiao_ble' } } as any,
  });

  it('emits the sampler when zephyr.trace.enabled is set', () => {
    const result = transpile('let x: number = 1;', {
      ...baseOpts(),
      platformContext: {
        frameworkData: { target: 'xiao_ble' },
        zephyr: { trace: { enabled: true } },
      } as any,
    });
    expect(result.header ?? result.cpp).toContain('// CUTTLEFISH_TRACE_BEGIN');
    expect(result.header ?? result.cpp).toContain('__tc_trace_hb_boot');
    expect(result.header ?? result.cpp).toContain('SYS_INIT(__tc_trace_hb_boot, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY)');
    expect(result.header ?? result.cpp).toContain('k_thread_foreach(__tc_trace_thread_line, nullptr)');
    expect(result.header ?? result.cpp).toContain('#if defined(CUTTLEFISH_ENTRY_TU) && defined(CONFIG_THREAD_MONITOR) && defined(CONFIG_THREAD_RUNTIME_STATS)');
  });

  it('bakes the default interval (1000 ms) and honors intervalMs', () => {
    const withDefault = transpile('let x: number = 1;', {
      ...baseOpts(),
      platformContext: { frameworkData: { target: 'xiao_ble' }, zephyr: { trace: { enabled: true } } } as any,
    });
    expect(withDefault.header ?? withDefault.cpp).toContain('#define __TC_TRACE_HB_MS 1000U');
    expect(withDefault.header ?? withDefault.cpp).toContain('[TR:CFG:1:1000]');

    const withCustom = transpile('let x: number = 1;', {
      ...baseOpts(),
      platformContext: { frameworkData: { target: 'xiao_ble' }, zephyr: { trace: { enabled: true, intervalMs: 250 } } } as any,
    });
    expect(withCustom.header ?? withCustom.cpp).toContain('#define __TC_TRACE_HB_MS 250U');
    expect(withCustom.header ?? withCustom.cpp).toContain('[TR:CFG:1:250]');
  });

  it('emits nothing without the config record (and nothing for enabled: false)', () => {
    const plain = transpile('let x: number = 1;', baseOpts());
    expect(plain.header ?? plain.cpp).not.toContain('CUTTLEFISH_TRACE_BEGIN');
    // (The Trace.mark/event [TR:EV helpers DO emit unconditionally — only
    // the heartbeat sampler is config-gated.)
    expect(plain.header ?? plain.cpp).not.toContain('__tc_trace_hb');

    const off = transpile('let x: number = 1;', {
      ...baseOpts(),
      platformContext: { frameworkData: { target: 'xiao_ble' }, zephyr: { trace: { enabled: false } } } as any,
    });
    expect(off.header ?? off.cpp).not.toContain('__tc_trace_hb_boot');
  });

  it('names started threads so heartbeats report them (k_thread_name_set)', () => {
    const result = transpile(
      'import { Thread } from "@typecad/hal";\n' +
      'const worker = new Thread(0, { stackKb: 2 });\n' +
      'worker.start((): void => { while (true) { } });\n',
      baseOpts(),
    );
    expect(result.cpp).toContain('k_thread_name_set(&__tc_thrd0_thread, "tc_thread_0")');
  });
});

// Trace.mark / Trace.event — user timeline events. The helpers emit
// UNCONDITIONALLY (a call site must never fail to link because tracing is
// off), values interpolate as runtime expressions inside static_cast.
describe('ZephyrStrategy Trace.mark / Trace.event lowering', () => {
  const opts = {
    strategy: new ZephyrStrategy(),
    target: 'zephyr',
    platformContext: { frameworkData: { target: 'xiao_ble' } } as any,
  };

  it('lowers mark/event to the [TR:EV helpers, which exist without zephyr.trace', () => {
    const result = transpile(
      'import { Trace } from "@typecad/hal";\n' +
      'let v: number = 3;\n' +
      'Trace.mark("connected");\n' +
      'Trace.event("errors", v + 1);\n',
      opts,
    );
    expect(result.cpp).toContain('__tc_trace_mark("connected");');
    expect(result.cpp).toContain('__tc_trace_event("errors", static_cast<double>(v + 1));');
    // Helpers are emitted unconditionally — tracing was NOT enabled here.
    expect(result.cpp).toContain('inline void __tc_trace_mark(const char* name)');
    expect(result.cpp).toContain('[TR:EV:%u:%s');
    // No heartbeat block leaked in for an untraced program.
    expect(result.cpp).not.toContain('__tc_trace_hb_boot');
  });
});

// The UI frame-stats block: always present for UI programs (call-site
// safety), active only under CUTTLEFISH_TRACE_UI (defined by the traced
// entry block). Heartbeat reports it per interval when withUi.
describe('trace UI frame-stats block', () => {
  it('uiFrameTraceLines compiles away without CUTTLEFISH_TRACE_UI', () => {
    const lines = uiFrameTraceLines().join('\n');
    expect(lines).toContain('#if defined(CUTTLEFISH_TRACE_UI)');
    expect(lines).toContain('static uint32_t __tc_trace_ui_frames = 0U;');
    expect(lines).toContain('__tc_trace_ui_frame(uint32_t frame_delta_ms)');
    expect(lines).toContain('(void)frame_delta_ms;');
    expect(lines).toContain('[TR:UI:%u:%u:%u:%u');
  });

  it('heartbeat emits the UI report calls only when withUi', () => {
    const withUi = traceHeartbeatLines(1000, true).join('\n');
    expect(withUi).toContain('__tc_trace_ui_report(__tc_trace_seq);');
    expect(withUi).toContain('__tc_trace_ui_reset();');
    const without = traceHeartbeatLines(1000, false).join('\n');
    expect(without).not.toContain('__tc_trace_ui_report');
  });
});
