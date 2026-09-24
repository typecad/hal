// ---------------------------------------------------------------------------
// Thin Thread (hal/thread.ts) — state block, lowering, and an end-to-end
// transpile proving the callback registration flows through start(fn).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { threadStateLines, lowerThread } from '../../../../packages/framework-zephyr/src/lowering/thread';
import { transpileZephyrStrategy, expectCppContains } from '../../../setup';

describe('thread state block', () => {
  it('emits a sized stack + k_thread + entry trampoline per slot', () => {
    const lines = threadStateLines(0, 4096).join('\n');
    expect(lines).toContain('// CUTTLEFISH_THREAD_BEGIN');
    expect(lines).toContain('K_THREAD_STACK_DEFINE(__tc_thrd0_stack, 4096);');
    expect(lines).toContain('static struct k_thread __tc_thrd0_thread;');
    expect(lines).toContain('static void __tc_thrd0_tramp(void* a, void* b, void* c)');
    expect(lines).toContain('if (__tc_thrd0_fn) { __tc_thrd0_fn(); }');
  });
});

describe('thread lowering', () => {
  it('start stores the entry, creates + schedules, and names the thread (trace labels)', () => {
    const out = lowerThread({ operation: 'thread.start', instance: 0, stackBytes: 2048, priority: 5, handler: 'workerLoop' } as any);
    expect(out.code).toBe('__tc_thrd0_fn = (workerLoop); (void)k_thread_create(&__tc_thrd0_thread, __tc_thrd0_stack, K_THREAD_STACK_SIZEOF(__tc_thrd0_stack), __tc_thrd0_tramp, NULL, NULL, NULL, 5, 0, K_NO_WAIT); (void)k_thread_name_set(&__tc_thrd0_thread, "tc_thread_0");');
  });

  it('join blocks with K_FOREVER', () => {
    const out = lowerThread({ operation: 'thread.join', instance: 1 } as any);
    expect(out.code).toBe('(void)k_thread_join(&__tc_thrd1_thread, K_FOREVER);');
  });
});

describe('Thread end-to-end (esp32s3 target)', () => {
  it('start(fn) registers the closure and emits state + create', () => {
    const result = transpileZephyrStrategy(`
      import { Thread, Time } from '@typecad/hal';

      const worker = new Thread(0, { stackKb: 4, priority: 3 });
      worker.start((): void => {
        Time.sleep(100);
      });
      worker.join();
    `);

    // Per-slot state: the 4 kB construction stack sized the K_THREAD_STACK.
    expectCppContains(result, [
      'K_THREAD_STACK_DEFINE(__tc_thrd0_stack, 4096);',
      'static struct k_thread __tc_thrd0_thread;',
      '__tc_thrd0_fn = (',
      'k_thread_create(&__tc_thrd0_thread, __tc_thrd0_stack, K_THREAD_STACK_SIZEOF(__tc_thrd0_stack), __tc_thrd0_tramp, NULL, NULL, NULL, 3, 0, K_NO_WAIT)',
      '(void)k_thread_join(&__tc_thrd0_thread, K_FOREVER);',
    ]);
  });
});
