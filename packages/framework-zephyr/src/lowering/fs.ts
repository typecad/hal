// ---------------------------------------------------------------------------
// Filesystem lowering — Zephyr FS API (littlefs on the storage partition)
//
// HAL `fs.*` (begin/read_text/write_text/exists/remove) maps onto Zephyr's
// <zephyr/fs/fs.h>. A littlefs filesystem is mounted at "/lfs" on the board's
// `storage_partition` fixed-partition (the same partition the ZMS settings
// backend uses for preferences — a program should not use both surfaces at
// once without dedicating separate partitions). The mount is lazy: it formats
// + remounts on first use when the partition is unformatted.
//
// The HAL paths are treated as paths WITHIN the filesystem: the shim joins the
// mount point, so fs.read_text("/data.txt") reads "/lfs/data.txt". This keeps
// the mount point an implementation detail.
//
// Requires Kconfig CONFIG_FILE_SYSTEM + CONFIG_FILE_SYSTEM_LITTLEFS (+ FLASH /
// FLASH_MAP) — emitted by the scaffold when the program uses fs.* — and the
// storage_partition node (added by the overlay).
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

/**
 * Emit the littlefs mount + the typed helper API the lowering calls into.
 * Called from shimLines when the program uses the filesystem. The helpers are
 * `static` so multiple TUs that carry the shim (guarded by the include guard)
 * do not collide.
 */
export function fsInitLines(): string[] {
  return [
    '// CUTTLEFISH_FS_BEGIN',
    'static struct fs_mount_t __tc_fs_mp;',
    'static bool __tc_fs_mounted = false;',
    '',
    'FS_LITTLEFS_DECLARE_DEFAULT_CONFIG(__tc_fs_data);',
    'static struct fs_mount_t __tc_fs_mp_init = {',
    '    .type = FS_LITTLEFS,',
    '    .mnt_point = "/lfs",',
    '    .fs_data = &__tc_fs_data,',
    '    .storage_dev = (void *)FIXED_PARTITION_ID(storage_partition),',
    '};',
    '',
    'static void __tc_fs_ensure_mount(void) {',
    '    if (__tc_fs_mounted) return;',
    '    __tc_fs_mp = __tc_fs_mp_init;',
    '    int rc = fs_mount(&__tc_fs_mp);',
    '    if (rc != 0) {',
    '        // Any mount failure with a valid config means the partition is',
    '        // unformatted or corrupt (littlefs reports -EIO on erased flash,',
    '        // not only -ENODATA/-EINVAL) — format it and remount once.',
    '        (void)fs_mkfs(FS_LITTLEFS, static_cast<uintptr_t>(FIXED_PARTITION_ID(storage_partition)), NULL, 0);',
    '        rc = fs_mount(&__tc_fs_mp);',
    '    }',
    '    if (rc == 0) {',
    '        __tc_fs_mounted = true;',
    '    } else {',
    '        char __tc_fs_err[48];',
    '        (void)snprintf(__tc_fs_err, sizeof(__tc_fs_err), "typecad-hal-fs: mount failed rc=%d", rc);',
    '        __tc_println(__tc_fs_err);',
    '    }',
    '}',
    '',
    '// Join the mount point with the user path (paths are within the FS).',
    'static const char* __tc_fs_path(const char* p) {',
    '    static char buf[128];',
    '    if (!p) return "/lfs";',
    '    const char* s = (p[0] == \'/\') ? p + 1 : p;',
    '    (void)snprintf(buf, sizeof(buf), "/lfs/%s", s);',
    '    return buf;',
    '}',
    '',
    'static bool __tc_fs_begin(void) { __tc_fs_ensure_mount(); return true; }',
    '',
    'static const char* __tc_fs_read_text(const char* path) {',
    '    __tc_fs_ensure_mount();',
    '    static char buf[256];',
    '    buf[0] = 0;',
    '    struct fs_file_t f;',
    '    fs_file_t_init(&f);',
    '    if (fs_open(&f, __tc_fs_path(path), FS_O_READ) == 0) {',
    '        // Terminate at the READ length: the buffer is static and shared',
    '        // across reads, so bytes from a longer previous file survive a',
    '        // short read otherwise.',
    '        ssize_t n = fs_read(&f, buf, sizeof(buf) - 1);',
    '        buf[(n > 0) ? n : 0] = 0;',
    '        (void)fs_close(&f);',
    '    }',
    '    return buf;',
    '}',
    '',
    'static void __tc_fs_write_text(const char* path, const char* content) {',
    '    __tc_fs_ensure_mount();',
    '    struct fs_file_t f;',
    '    fs_file_t_init(&f);',
    '    if (fs_open(&f, __tc_fs_path(path), FS_O_WRITE | FS_O_CREATE | FS_O_TRUNC) == 0) {',
    '        (void)fs_write(&f, content, (content ? strlen(content) : 0));',
    '        (void)fs_close(&f);',
    '    }',
    '}',
    '',
    'static bool __tc_fs_exists(const char* path) {',
    '    __tc_fs_ensure_mount();',
    '    struct fs_dirent ent;',
    '    return fs_stat(__tc_fs_path(path), &ent) == 0;',
    '}',
    '',
    'static bool __tc_fs_remove(const char* path) {',
    '    __tc_fs_ensure_mount();',
    '    return fs_unlink(__tc_fs_path(path)) == 0;',
    '}',
    '// CUTTLEFISH_FS_END',
  ];
}

/**
 * Resolve a HAL fs.* op to Zephyr C++.
 * Returns `{ code }` — each op's code is the body of the HAL FS class method.
 */
export function lowerFs(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'fs.read_text':
      return { code: `return __tc_fs_read_text(${o.path});` };
    case 'fs.write_text':
      return { code: `__tc_fs_write_text(${o.path}, ${o.content});` };
    case 'fs.exists':
      return { code: `return __tc_fs_exists(${o.path});` };
    case 'fs.remove':
      return { code: `return __tc_fs_remove(${o.path});` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
