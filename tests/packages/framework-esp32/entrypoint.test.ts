import { describe, it, expect } from 'vitest';
import { Esp32Strategy } from '../../../packages/framework-esp32/src/strategy';

const strategy = new Esp32Strategy();
const fakeProgram = {} as any;
const ctx = { frameworkData: { target: 'esp32' } } as any;

describe('Esp32Strategy app_main entrypoint', () => {
  const shim = strategy.shimLines(fakeProgram, ctx).join('\n');

  it('emits extern "C" void app_main(void)', () => {
    expect(shim).toMatch(/extern\s+"C"\s+void\s+app_main\s*\(\s*void\s*\)/);
  });

  it('calls setup() directly from app_main (IDF-idiomatic — no spawned task)', () => {
    // Matches the official esp_http_client example: app_main itself blocks on
    // WiFi connect. We previously spawned a __tc_app_task to host setup/loop;
    // that was non-idiomatic and caused watchdog resets under WiFi load.
    expect(shim).toMatch(/extern\s+"C"\s+void\s+app_main\([^)]*\)\s*{[^}]*\bsetup\(\)/);
  });

  it('runs loop() in a for(;;) inside app_main', () => {
    expect(shim).toMatch(/extern\s+"C"\s+void\s+app_main\([^)]*\)\s*{[\s\S]*?for\s*\(\s*;;\s*\)[\s\S]*?\bloop\(\)/);
  });

  it('yields with vTaskDelay(1) inside the loop to prevent watchdog starvation', () => {
    // An empty or non-blocking loop() would starve the IDLE task and trigger
    // the task watchdog. The loop yields 1 tick per iteration.
    expect(shim).toMatch(/vTaskDelay\(1\)/);
  });

  it('does NOT spawn __tc_app_task (regression guard — spawned task caused WDT resets)', () => {
    // The old pattern spawned a prio-1 task to run setup/loop while main_task
    // sat idle and deleted itself. That fought IDF's WDT/scheduler assumptions
    // (the prio-23 WiFi task starved CPU0's IDLE while our prio-1 task was
    // scheduled there). The fix is to run setup/loop in main_task directly.
    expect(shim).not.toMatch(/__tc_app_task/);
    expect(shim).not.toMatch(/xTaskCreate\s*\(\s*__tc_app_task/);
    expect(shim).not.toMatch(/vTaskDelete\s*\(\s*NULL\s*\)/);
  });

  it('does not reference loopTask (the arduino-esp32 core\'s task)', () => {
    expect(shim).not.toMatch(/\bloopTask\b/);
  });
});
