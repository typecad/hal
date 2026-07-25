import { describe, it, expect } from 'vitest';
import { lowerOta, otaInitLines } from '../../../../packages/framework-esp32/src/lowering/ota';

describe('ota init block', () => {
  it('emits CUTTLEFISH_OTA markers and the esp_https_ota / esp_ota_ops wrappers', () => {
    const lines = otaInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_OTA_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_OTA_END');
    expect(lines).toContain('esp_https_ota');
    expect(lines).toContain('esp_ota_get_next_update_partition');
    expect(lines).toContain('esp_ota_begin');
    expect(lines).toContain('esp_ota_write');
    expect(lines).toContain('esp_ota_set_boot_partition');
    expect(lines).toContain('esp_restart');
  });
});

describe('ota lowering', () => {
  it('ota.from_url → __tc_ota_from_url(url) expression (bool)', () => {
    const out = lowerOta({ operation: 'ota.from_url', url: '"https://fw/x.bin"' } as any);
    expect(out.expression).toBe('__tc_ota_from_url("https://fw/x.bin")');
  });
  it('ota.begin → boolean expression', () => {
    const out = lowerOta({ operation: 'ota.begin' } as any);
    expect(out.expression).toBe('__tc_ota_begin()');
  });
  it('ota.write → statement', () => {
    const out = lowerOta({ operation: 'ota.write', chunk: 'buf' } as any);
    expect(out.code).toBe('__tc_ota_write(buf);');
  });
  it('ota.apply → statement', () => {
    const out = lowerOta({ operation: 'ota.apply' } as any);
    expect(out.code).toBe('__tc_ota_apply();');
  });
  it('unknown ota.* op throws', () => {
    expect(() => lowerOta({ operation: 'ota.bogus' } as any)).toThrow();
  });
});
