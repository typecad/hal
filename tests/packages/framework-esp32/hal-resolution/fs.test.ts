import { describe, it, expect } from 'vitest';
import { lowerFs, fsInitLines } from '../../../../packages/framework-esp32/src/lowering/fs';
import { transpileEsp32Strategy } from '../../../setup';

describe('fs init block', () => {
  it('emits CUTTLEFISH_FS markers and the SDMMC mount', () => {
    const lines = fsInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_FS_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_FS_END');
    // Native ESP-IDF FAT-on-SDMMC mount — not Arduino SD.h.
    expect(lines).toContain('esp_vfs_fat_sdmmc_mount');
    expect(lines).toContain('SDMMC_HOST_DEFAULT');
    // POSIX file helpers backing readText/writeText/exists/remove.
    expect(lines).toContain('__tc_fs_read_text');
    expect(lines).toContain('__tc_fs_write_text');
    expect(lines).toContain('__tc_fs_exists');
    expect(lines).toContain('__tc_fs_remove');
    // Must not reference Arduino SD.h / File / String.
    expect(lines).not.toMatch(/\bSD\.begin\b/);
    expect(lines).not.toMatch(/\bString\b/);
  });
});

describe('fs sdmmc slot config', () => {
  it('defaults to 1-bit with no pin overrides (uses SDMMC_SLOT_CONFIG_DEFAULT)', () => {
    const lines = fsInitLines(null, 'esp32').join('\n');
    expect(lines).toContain('SDMMC_HOST_FLAG_1BIT');
    // No slot.gpio_* overrides → the comment marker is emitted instead.
    expect(lines).toMatch(/using SDMMC_SLOT_CONFIG_DEFAULT pins/);
    expect(lines).not.toMatch(/slot\.clk/);
  });

  it('applies user sdmmc pin overrides + 4-bit flag when width=4', () => {
    const lines = fsInitLines(
      { clk: 18, cmd: 19, d0: 5, d1: 21, d2: 22, d3: 23, width: 4 },
      'esp32',
    ).join('\n');
    expect(lines).toContain('SDMMC_HOST_FLAG_4BIT');
    expect(lines).toContain('slot.clk = (gpio_num_t)18');
    expect(lines).toContain('slot.cmd = (gpio_num_t)19');
    expect(lines).toContain('slot.d0 = (gpio_num_t)5');
    expect(lines).toContain('slot.d1 = (gpio_num_t)21');
    expect(lines).toContain('slot.d2 = (gpio_num_t)22');
    expect(lines).toContain('slot.d3 = (gpio_num_t)23');
    // d0 must not be duplicated.
    expect(lines.match(/slot\.d0/g)?.length).toBe(1);
  });

  it('applies only the pins the user sets (partial override)', () => {
    const lines = fsInitLines({ d0: 5 }, 'esp32').join('\n');
    // 1-bit default width (no width field → width 1).
    expect(lines).toContain('SDMMC_HOST_FLAG_1BIT');
    expect(lines).toContain('slot.d0 = (gpio_num_t)5');
    // Unset pins are not overridden.
    expect(lines).not.toMatch(/slot\.clk/);
  });

  it('records the resolved pins in the header comment', () => {
    const lines = fsInitLines({ clk: 18, cmd: 19, d0: 5 }, 'esp32').join('\n');
    expect(lines).toMatch(/clk=18 cmd=19 d0=5.*width 1/);
  });
});

describe('fs lowering', () => {
  it('fs.begin → __tc_fs_begin() statement', () => {
    const out = lowerFs({ operation: 'fs.begin' } as any);
    expect(out.code).toBe('__tc_fs_begin();');
    expect(out.expression).toBeUndefined();
  });

  it('fs.read_text → __tc_fs_read_text(path) expression', () => {
    const out = lowerFs({ operation: 'fs.read_text', path: '/sdcard/log.txt' } as any);
    expect(out.expression).toBe('__tc_fs_read_text(/sdcard/log.txt)');
    expect(out.code).toBeUndefined();
  });

  it('fs.write_text → __tc_fs_write_text(path, content) statement', () => {
    const out = lowerFs({ operation: 'fs.write_text', path: '"/sd/x"', content: '"hello"' } as any);
    expect(out.code).toBe('__tc_fs_write_text("/sd/x", "hello");');
  });

  it('fs.exists → boolean expression', () => {
    const out = lowerFs({ operation: 'fs.exists', path: '"/sd/x"' } as any);
    expect(out.expression).toBe('__tc_fs_exists("/sd/x")');
  });

  it('fs.remove → boolean expression', () => {
    const out = lowerFs({ operation: 'fs.remove', path: '"/sd/x"' } as any);
    expect(out.expression).toBe('__tc_fs_remove("/sd/x")');
  });

  it('unknown fs.* op throws', () => {
    expect(() => lowerFs({ operation: 'fs.bogus' } as any)).toThrow();
  });
});

describe('fs lowering end-to-end', () => {
  it('ESP32: FS.begin/readText/writeText lower to __tc_fs_* (not Arduino SD.h)', () => {
    const result = transpileEsp32Strategy(`
      import { FS } from '@typecad/hal';
      export function setup() {
        FS.begin();
        const s = FS.readText("/sd/log.txt");
        FS.writeText("/sd/log.txt", "data");
        console.log(s);
      }
    `);
    // The runtime shim must be emitted.
    expect(result.cpp).toContain('__tc_fs_begin');
    expect(result.cpp).toContain('__tc_fs_read_text');
    expect(result.cpp).toContain('__tc_fs_write_text');
    // The SDMMC mount + forced includes must be present.
    expect(result.cpp).toContain('esp_vfs_fat_sdmmc_mount');
    expect(result.cpp).toMatch(/esp_vfs_fat\.h/);
    // Arduino SD.h / File / String symbols must not leak in.
    expect(result.cpp).not.toMatch(/\bSD\.begin\b/);
  });
});
