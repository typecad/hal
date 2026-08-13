import { describe, it, expect } from 'vitest';
import { lowerFs, fsInitLines } from '../../../../packages/framework-zephyr/src/lowering/fs';

describe('fs init block', () => {
  it('emits the littlefs mount + typed helper API', () => {
    const lines = fsInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_FS_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_FS_END');
    // Mount point + storage partition.
    expect(lines).toContain('FS_LITTLEFS_DECLARE_DEFAULT_CONFIG');
    expect(lines).toContain('FIXED_PARTITION_ID(storage_partition)');
    expect(lines).toContain('.mnt_point = "/lfs"');
    // Helpers the lowering calls into.
    expect(lines).toContain('__tc_fs_begin');
    expect(lines).toContain('__tc_fs_read_text');
    expect(lines).toContain('__tc_fs_write_text');
    expect(lines).toContain('__tc_fs_exists');
    expect(lines).toContain('__tc_fs_remove');
  });

  it('formats the partition on first use when it is unformatted', () => {
    expect(fsInitLines().join('\n')).toContain('fs_mkfs(FS_LITTLEFS');
  });
});

describe('fs lowering', () => {
  it('fs.begin → mount helper (no payload referenced)', () => {
    const out = lowerFs({ operation: 'fs.begin' } as any);
    expect(out.code).toBe('return __tc_fs_begin();');
  });

  it('fs.read_text → read helper returning the path text', () => {
    const out = lowerFs({ operation: 'fs.read_text', path: '"/data.txt"' } as any);
    expect(out.code).toBe('return __tc_fs_read_text("/data.txt");');
  });

  it('fs.write_text → write helper with path + content', () => {
    const out = lowerFs({ operation: 'fs.write_text', path: '"/data.txt"', content: '"hello"' } as any);
    expect(out.code).toBe('__tc_fs_write_text("/data.txt", "hello");');
  });

  it('fs.exists → exists helper', () => {
    const out = lowerFs({ operation: 'fs.exists', path: '"/data.txt"' } as any);
    expect(out.code).toBe('return __tc_fs_exists("/data.txt");');
  });

  it('fs.remove → remove helper', () => {
    const out = lowerFs({ operation: 'fs.remove', path: '"/data.txt"' } as any);
    expect(out.code).toBe('return __tc_fs_remove("/data.txt");');
  });

  it('throws on an unhandled fs op', () => {
    expect(() => lowerFs({ operation: 'fs.bogus' } as any)).toThrow();
  });
});
