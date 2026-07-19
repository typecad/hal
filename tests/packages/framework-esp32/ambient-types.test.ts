import { describe, it, expect } from 'vitest';
import { Esp32Strategy } from '../../../packages/framework-esp32/src/strategy';

const strategy = new Esp32Strategy();

describe('Esp32Strategy ambientTypeDeclarations', () => {
  const decl = strategy.ambientTypeDeclarations().join('\n');

  it('declares Timing interface with millis/micros/delay/delayMicroseconds/freeHeap', () => {
    expect(decl).toMatch(/const Timing/);
    expect(decl).toMatch(/millis\(\): number/);
    expect(decl).toMatch(/micros\(\): number/);
    expect(decl).toMatch(/delay\(ms: number\): void/);
    expect(decl).toMatch(/delayMicroseconds\(us: number\): void/);
    expect(decl).toMatch(/freeHeap\(\): number/);
  });

  it('declares WDT interface with timeout parameter', () => {
    expect(decl).toMatch(/const WDT/);
    expect(decl).toMatch(/enable\(timeout/);
    expect(decl).toMatch(/reset\(\)/);
    expect(decl).toMatch(/disable\(\)/);
  });

  it('declares Preferences (type retained, lowering deferred to v1.1)', () => {
    expect(decl).toMatch(/const Preferences/);
    expect(decl).toMatch(/putInt|getInt/);
  });

  it('declares EEPROM (type retained, not lowered)', () => {
    expect(decl).toMatch(/const EEPROM/);
  });

  it('does NOT declare Arduino Serial', () => {
    expect(decl).not.toMatch(/const Serial/);
  });

  it('documents the IDF lowering relationships', () => {
    expect(decl).toMatch(/esp_timer_get_time/);
    expect(decl).toMatch(/esp_task_wdt/);
  });
});
