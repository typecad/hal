import { describe, it, expect } from 'vitest';
import { Esp32Strategy } from '../../../packages/framework-esp32/src/strategy';

const strategy = new Esp32Strategy();
const fakeProgram = {} as any;
const ctx = { frameworkData: { target: 'esp32' } } as any;

describe('Esp32Strategy app_main trampoline', () => {
  const shim = strategy.shimLines(fakeProgram, ctx).join('\n');

  it('emits extern "C" void app_main(void)', () => {
    expect(shim).toMatch(/extern\s+"C"\s+void\s+app_main\s*\(\s*void\s*\)/);
  });

  it('emits the __tc_app_task with setup() then for(;;) loop()', () => {
    expect(shim).toContain('__tc_app_task');
    expect(shim).toMatch(/setup\(\)/);
    expect(shim).toMatch(/for\s*\(\s*;;\s*\)/);
    expect(shim).toMatch(/loop\(\)/);
  });

  it('spawns the task with xTaskCreate', () => {
    expect(shim).toMatch(/xTaskCreate\s*\(\s*__tc_app_task/);
  });

  it('does not reference loopTask (the arduino-esp32 core\'s task)', () => {
    expect(shim).not.toMatch(/\bloopTask\b/);
  });

  it('task stack is 8192 and priority is 1', () => {
    expect(shim).toMatch(/xTaskCreate\s*\([^,]+,\s*"tc_app"\s*,\s*8192\s*,\s*NULL\s*,\s*1\s*,/);
  });
});
