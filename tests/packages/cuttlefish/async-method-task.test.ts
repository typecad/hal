// ---------------------------------------------------------------------------
// async-method-task.test.ts — async METHODS on user classes lower to
// owner-bound cooperative state-machine tasks.
//
// Regression: an async method used to render as an ordinary method — a
// blocking k_msleep inside `while (true)` (hang), an undefined `Promise`
// return type (compile error), and `this` referring to nothing coherent
// once the body conceptually left the instance. The fix generates one task
// class per async method whose `_owner` pointer is bound by a starter the
// in-class body calls; segment code renders `this->x` as `_owner->x`.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpileZephyrStrategy, findDiagnostics } from '../../setup';

const BLINKER_SRC = `
  import { Time } from '@typecad/hal';

  class Blinker {
    count: number = 0;
    async run(): Promise<void> {
      while (true) {
        this.count = this.count + 1;
        await Time.sleep(100);
      }
    }
  }
  const b = new Blinker();
  void b.run();
`;

describe('async methods lower to owner-bound tasks', () => {
  it('generates the task class with owner binding and this→_owner segments', () => {
    const r = transpileZephyrStrategy(BLINKER_SRC);

    // Owner-bound task: pointer member, start(), unstarted guard.
    expect(r.cpp).toContain('Blinker* _owner;');
    expect(r.cpp).toContain('void start(Blinker* owner)');
    expect(r.cpp).toContain('if (_owner == nullptr) { return; }');
    // The this-rebind: segment code touches the OWNER's field.
    expect(r.cpp).toContain('_owner->count = _owner->count + 1;');
    expect(r.cpp).not.toMatch(/Task[\s\S]{0,200}this->count/);
  });

  it('replaces the method body with the starter kick (void return, no Promise)', () => {
    const r = transpileZephyrStrategy(BLINKER_SRC);

    // In-class body: void signature + forward-declared starter call.
    expect(r.cpp).toMatch(/void run\(\) \{\s*__tc_async_start_Blinker_run\(this\);\s*\}/);
    // The prototype precedes the class; the definition follows the task.
    const protoIdx = r.cpp.indexOf('void __tc_async_start_Blinker_run(Blinker* owner);');
    const classIdx = r.cpp.indexOf('class Blinker {');
    const defIdx = r.cpp.indexOf('__tc_async_start_Blinker_run(Blinker* owner) {');
    const taskIdx = r.cpp.indexOf('class BlinkerRunTask');
    expect(protoIdx).toBeGreaterThanOrEqual(0);
    expect(protoIdx).toBeLessThan(classIdx);
    expect(taskIdx).toBeGreaterThan(classIdx);
    expect(defIdx).toBeGreaterThan(taskIdx);
    // No phantom runtime: the Promise type no longer reaches the C++.
    expect(r.cpp).not.toContain('Promise');
  });

  it('pumps the task from the driver loop and kicks it from main', () => {
    const r = transpileZephyrStrategy(BLINKER_SRC);

    const main = (r.cpp.match(/int main\(\)\s*\{[\s\S]*?\n\}/) ?? [''])[0];
    expect(main).toContain('b->run();');
    expect(r.cpp).toContain('BlinkerRunTask Blinker_runTask;');
    // The `void b.run();` fire-and-forget idiom must survive statement
    // lowering — the raw (void)(...) form dropped the call entirely.
    expect(r.cpp).toMatch(/Blinker_runTask\.run\(\);/);
  });

  it('diagnoses awaited user-function calls instead of silently dropping them', () => {
    const r = transpileZephyrStrategy(`
      import { Time } from '@typecad/hal';
      async function inner(): Promise<void> { await Time.sleep(50); }
      async function outer(): Promise<void> { await inner(); await Time.sleep(10); }
      void outer();
    `);
    const diags = findDiagnostics(r, 'await-unsupported-call');
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain('await inner(...)');
  });

  it('diagnoses static async methods and async methods with parameters', () => {
    const r = transpileZephyrStrategy(`
      import { Time } from '@typecad/hal';
      class A {
        static async tick(): Promise<void> { await Time.sleep(10); }
      }
      class B {
        async go(n: number): Promise<void> { await Time.sleep(n); }
      }
    `);
    expect(findDiagnostics(r, 'async-method-static').length).toBe(1);
    expect(findDiagnostics(r, 'async-method-params').length).toBe(1);
  });
});
