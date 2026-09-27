// ---------------------------------------------------------------------------
// async-duff-device.test.ts — the local-continuation (Duff's-device) async
// transform.
//
// Regression: the former flat segment model rendered control flow inside
// async bodies through a HEADER-ONLY statement renderer — an `if` inside the
// loop dropped the whole body (`while (true) _state = STATE_DONE;`), an
// `await` inside `while (cond)` silently became the next statement's loop
// body, and locals never persisted across awaits. The transform now preserves
// the control flow as real C++, splits awaits in place
// (`arm; _state = N; return; case N: gate;`), and hoists locals to `_v_`
// members.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpileZephyrStrategy, findDiagnostics, normalizeCpp } from '../../setup';

describe('async bodies with nested control flow lower correctly', () => {
  it('preserves an if inside the while body (the dropped-body regression)', () => {
    const r = transpileZephyrStrategy(`
      import { WiFi, Time } from '@typecad/hal';
      const wifi = new WiFi('x', { psk: 'y' });
      async function watch() {
        let wasUp = false;
        while (true) {
          const up = wifi.linked();
          if (up && !wasUp) { wifi.leave(); }
          wasUp = up;
          await Time.sleep(500);
        }
      }
      watch();
    `);

    // The if and its body survive inside the emitted while.
    expect(r.cpp).toMatch(/while \(true\)[\s\S]{0,400}if \(_v_up && !_v_wasUp\)[\s\S]{0,120}\{[\s\S]{0,200}__tc_wifi_disconnect\(\);[\s\S]{0,40}\}/);
    // The loop-carried local is a member that persists across runs.
    expect(r.cpp).toContain('bool _v_wasUp;');
    expect(r.cpp).toMatch(/_v_wasUp = _v_up;/);
    // The await splits in place with a resume label + deadline gate.
    expect(r.cpp).toMatch(/_waitUntil = __tc_now_ms\(\) \+ 500;\s*_state = State::STATE_1;\s*return;\s*case State::STATE_1:/);
  });

  it('keeps the statement after an awaited conditional loop (the misplaced-statement regression)', () => {
    const r = transpileZephyrStrategy(`
      import { WiFi, Time } from '@typecad/hal';
      const wifi = new WiFi('x', { psk: 'y' });
      async function connect() {
        while (!wifi.linked()) {
          await Time.sleep(100);
        }
        wifi.leave();
      }
      connect();
    `);

    // wifi.leave() renders AFTER the loop closes — it used to become the
    // while's loop body (an infinite spin that never reached it).
    const task = (r.cpp.match(/class ConnectTask[\s\S]*?\n\};/) ?? [''])[0];
    expect(task).toMatch(/while \(!\(__tc_wifi\.connected\)\)[\s\S]*?case State::STATE_1:[\s\S]*?\}\s*__tc_wifi_disconnect\(\);/);
  });

  it('splits awaits nested inside if branches with correct resume labels', () => {
    const r = transpileZephyrStrategy(`
      import { WiFi, Time } from '@typecad/hal';
      const wifi = new WiFi('x', { psk: 'y' });
      async function poll() {
        while (true) {
          if (wifi.linked()) {
            wifi.leave();
            await Time.sleep(250);
            wifi.leave();
          }
          await Time.sleep(1000);
        }
      }
      poll();
    `);

    // Two await sites → STATE_1 and STATE_2, each with a gate; the second
    // leave() renders after the first site's gate (the continuation).
    expect(r.cpp).toMatch(/case State::STATE_1:[\s\S]{0,120}__tc_wifi_disconnect\(\);/);
    expect(r.cpp).toMatch(/case State::STATE_2:[\s\S]{0,200}_state = State::STATE_DONE;|\case State::STATE_2:[\s\S]{0,200}return;/);
    expect(r.cpp).toContain('enum class State { STATE_0, STATE_1, STATE_2, STATE_DONE }');
  });

  it('supports continue after an await inside the loop', () => {
    const r = transpileZephyrStrategy(`
      import { WiFi, Time } from '@typecad/hal';
      const wifi = new WiFi('x', { psk: 'y' });
      async function retry() {
        while (true) {
          if (!wifi.linked()) {
            await Time.sleep(1000);
            continue;
          }
          wifi.leave();
          await Time.sleep(5000);
        }
      }
      retry();
    `);

    expect(normalizeCpp(r.cpp)).toContain('continue;');
    // The continue sits right after the resume gate of the await it follows.
    expect(r.cpp).toMatch(/case State::STATE_1:[\s\S]{0,80}\n\s*continue;/);
  });

  it('hoists pointer locals and arrows their member calls', () => {
    const r = transpileZephyrStrategy(`
      import { Time } from '@typecad/hal';
      class Win {
        private readonly _t: number[];
        constructor() { this._t = new Array<number>(4); }
        push(v: number): void { this._t[0] = v; }
        first(): number { return this._t[0]; }
      }
      async function sample() {
        const w = new Win();
        while (true) {
          w.push(21.5);
          await Time.sleep(1000);
        }
      }
      sample();
    `);

    expect(r.cpp).toContain('Win* _v_w;');
    expect(r.cpp).toMatch(/_v_w->push\(21\.5\)/);
  });

  it('rewrites hoisted names inside raw text (template fragments, op-carried sleeps)', () => {
    const r = transpileZephyrStrategy(`
      import { WiFi, Time, UART0 } from '@typecad/hal';
      const wifi = new WiFi('x', { psk: 'y' });
      function clampv(v: number, lo: number, hi: number): number { return v < lo ? lo : (v > hi ? hi : v); }
      async function backoff() {
        let waitMs = 5000;
        while (true) {
          const w = clampv(waitMs, 5000, 60000);
          UART0.writeLine(\`retry in \${w / 1000} s\`);
          waitMs = waitMs * 2;
          await Time.sleep(w);
        }
      }
      backoff();
    `);

    // The template fragment and the awaited duration both carry the local by
    // its original name at IR time — the emitted lines must use the member.
    expect(r.cpp).toMatch(/static_cast<double>\(_v_w\) \/ static_cast<double>\(1000\)/);
    expect(r.cpp).toMatch(/_waitUntil = __tc_now_ms\(\) \+ _v_w;/);
  });
});

describe('async diagnostics for unsupported shapes', () => {
  it('diagnoses value-position awaits instead of silently dropping them', () => {
    const r = transpileZephyrStrategy(`
      import { WiFi } from '@typecad/hal';
      const wifi = new WiFi('x', { psk: 'y' });
      async function go() {
        const ok = await wifi.join();
        wifi.leave();
      }
      go();
    `);
    const diags = findDiagnostics(r, 'await-value-position');
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].message).toContain('expression position');
  });

  it('diagnoses switch inside async bodies (case labels would collide)', () => {
    const r = transpileZephyrStrategy(`
      import { Time } from '@typecad/hal';
      async function go() {
        let mode = 0;
        while (true) {
          switch (mode) {
            case 0: { mode = 1; break; }
            default: { mode = 0; break; }
          }
          await Time.sleep(100);
        }
      }
      go();
    `);
    expect(findDiagnostics(r, 'async-unsupported-statement').length).toBeGreaterThanOrEqual(1);
  });
});
