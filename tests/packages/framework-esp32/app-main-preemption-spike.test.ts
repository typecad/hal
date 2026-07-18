import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// HISTORICAL REGRESSION TEST.
//
// This test records WHY framework-esp32 uses native idf.py rather than
// arduino-cli. An earlier design proposed using arduino-cli with an app_main
// symbol-preemption trick (the ESP32 analog of framework-avr's `int main(void)`
// on AVR). The trick FAILS on arduino-cli's ESP32 toolchain: the arduino-esp32
// core packages main.cpp.o (which defines app_main) inside core.a as a strong
// symbol, and the link order in arduino-cli's ESP32 build does not allow a
// sketch-level app_main to preempt it. The link error is:
//
//   core.a(main.cpp.o): in function `app_main':
//   .../hardware/esp32/3.0.7/cores/esp32/main.cpp:81: multiple definition of
//   `app_main'; .../sketch/handwritten-app-main.ino.cpp.o:...: first defined here
//
// This test asserts that failure still occurs. If preemption ever starts
// working (link order changes, core weakens the symbol, etc.), this test will
// FAIL — which is the trigger to revisit the arduino-cli approach.

const SKETCH_DIR = join(import.meta.dirname, 'fixtures', 'handwritten-app-main');
const SKETCH_INO = join(SKETCH_DIR, 'handwritten-app-main.ino');

function arduinoCliAvailable(): boolean {
  const r = spawnSync('arduino-cli', ['version'], { encoding: 'utf8', shell: true });
  return r.status === 0 && /arduino-cli/.test(r.stdout ?? '');
}

function esp32CoreInstalled(): boolean {
  const r = spawnSync('arduino-cli', ['core', 'list'], { encoding: 'utf8', shell: true });
  return r.status === 0 && /^\s*esp32:esp32\s+/m.test(r.stdout ?? '');
}

const SKIP = !arduinoCliAvailable() || !esp32CoreInstalled();
const itMaybe = SKIP ? it.skip : it;

describe('app_main symbol preemption — historical regression (arduino-cli path was abandoned)', () => {
  itMaybe('arduino-cli rejects sketch-level app_main with multiple-definition error', () => {
    expect(existsSync(SKETCH_INO)).toBe(true);
    const result = spawnSync(
      'arduino-cli',
      ['compile', '--fqbn', 'esp32:esp32:esp32', SKETCH_DIR],
      { encoding: 'utf8', shell: true, timeout: 180000 },
    );
    const combined = (result.stderr ?? '') + (result.stdout ?? '');

    // The compile MUST fail with the duplicate-symbol error. If it succeeds,
    // preemption has started working and the framework-esp32 design should be
    // revisited (it may be able to return to arduino-cli).
    expect(result.status).not.toBe(0);
    expect(combined).toMatch(/multiple definition of [`']?app_main[`']?/);
  }, 200000);
});
