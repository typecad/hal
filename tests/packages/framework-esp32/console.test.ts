import { describe, it, expect } from 'vitest';
import { Esp32Strategy } from '../../../packages/framework-esp32/src/strategy';

const strategy = new Esp32Strategy();

describe('Esp32Strategy transformConsoleCall', () => {
  it('console.log → printf', () => {
    const out = strategy.transformConsoleCall('log', '"hello"', false);
    expect(out).toMatch(/^printf\(/);
    expect(out).toContain('"hello"');
    expect(out).toMatch(/;\s*$/);
  });
  it('console.log in header has no trailing semicolon', () => {
    const out = strategy.transformConsoleCall('log', '"hi"', true);
    expect(out).not.toMatch(/;\s*$/);
  });
  it('console.error → ESP_LOGE', () => {
    const out = strategy.transformConsoleCall('error', '"boom"', false);
    expect(out).toMatch(/^ESP_LOGE\("tc"/);
  });
  it('console.warn → ESP_LOGW', () => {
    expect(strategy.transformConsoleCall('warn', '"careful"', false))
      .toMatch(/^ESP_LOGW\("tc"/);
  });
  it('console.info → ESP_LOGI', () => {
    expect(strategy.transformConsoleCall('info', '"hi"', false))
      .toMatch(/^ESP_LOGI\("tc"/);
  });
  it('console.debug → ESP_LOGD', () => {
    expect(strategy.transformConsoleCall('debug', '"dbg"', false))
      .toMatch(/^ESP_LOGD\("tc"/);
  });
  it('error/warn/debug/info get a [LEVEL] prefix from the macro', () => {
    const out = strategy.transformConsoleCall('error', '"boom"', false);
    // The prefix is itself an ESP_LOGE call (the [ERROR] tag line).
    expect(out).toMatch(/ESP_LOGE.*\[ERROR\]/);
  });
  it('stream chain splits into multiple calls', () => {
    const out = strategy.transformConsoleCall('log', '"x=" << x', false);
    expect(out).toMatch(/printf\(/);
    // Two printf calls expected (one per chain part).
    const callCount = (out.match(/printf\(/g) ?? []).length;
    expect(callCount).toBe(2);
  });
});

describe('Esp32Strategy generateNativePolyfills', () => {
  // Parent's generateNativePolyfills reads program.functions; provide a minimal stub.
  const fakeProgram = { functions: [], fileName: 'test.ts' } as any;
  const polys = strategy.generateNativePolyfills(fakeProgram, undefined);

  it('cuttlefish_halt uses esp_system_abort (not Serial.println)', () => {
    const halt = polys.find((p) => p.id === 'cuttlefish_halt');
    expect(halt).toBeDefined();
    expect(halt!.helperFunctions.join('\n')).toContain('esp_system_abort');
    expect(halt!.helperFunctions.join('\n')).not.toContain('Serial.println');
  });

  it('cuttlefish_halt domain is esp32', () => {
    const halt = polys.find((p) => p.id === 'cuttlefish_halt');
    expect(halt!.domain).toBe('esp32');
  });

  it('inherits string_methods polyfill from parent (unchanged)', () => {
    const sm = polys.find((p) => p.id === 'string_methods');
    expect(sm).toBeDefined();
  });
});
