import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { SdmmcSlotConfig } from '../components/types.js';

/**
 * Native ESP-IDF filesystem runtime shim (`__tc_fs_*`). Mounts an SD card via
 * esp_vfs_fat_sdmmc_mount (FAT on the SDMMC host), then exposes the HAL FS
 * surface as string-oriented helpers. After mount, files are reachable through
 * the ordinary POSIX/VFS path (open/read/write/close), so the helpers are thin
 * wrappers around fopen/fread/fwrite.
 *
 * Design notes:
 *  - The mount is lazy (first fs.begin()) and idempotent.
 *  - SDMMC slot pins come from `frameworkData.sdmmc` (cuttlefish.config.ts) when
 *    provided; otherwise the lowering uses `SDMMC_SLOT_CONFIG_DEFAULT()`, which
 *    reads ESP-IDF's Kconfig defaults for the chip (classic ESP32: CLK=14,
 *    CMD=15, D0=2, D1=4; S3 differs). The slot config is applied in code
 *    (slot.gpio_* overrides), not via Kconfig, so users set pins in their
 *    config file rather than editing sdkconfig / running menuconfig.
 *  - readText returns a heap char* (malloc'd, caller frees via the runtime's
 *    string ownership). The buffer is NUL-terminated and sized to the file.
 *  - writeText overwrites (mode "w"); exists/remove map to stat/unlink.
 *
 * Lowered via framework-esp32/src/lowering/fs.ts. Forced includes
 * (esp_vfs_fat.h, sdmmc_cmd.h, etc.) are gated on usesFS in strategy.ts.
 */

/**
 * Default SDMMC slot pins per ESP32 target, used when the user does not supply
 * `frameworkData.sdmmc`. These match ESP-IDF's `SDMMC_SLOT_CONFIG_DEFAULT()`
 * Kconfig values and are surfaced here so generated code is self-documenting
 * (the user can read the pins in the emitted comment without hunting Kconfig).
 *
 * Classic ESP32: CLK=14, CMD=15, D0=2, D1=4, D2=12, D3=13 (4-bit).
 * ESP32-S3:      CLK=39, CMD=38, D0=40, D1=41, D2=42, D3=42 (module-dependent).
 */
const SDMMC_DEFAULT_PINS: Record<string, Required<SdmmcSlotConfig>> = {
  esp32:   { clk: 14, cmd: 15, d0: 2,  d1: 4,  d2: 12, d3: 13, width: 1 },
  esp32s3: { clk: 39, cmd: 38, d0: 40, d1: 41, d2: 42, d3: 42, width: 1 },
  esp32c3: { clk: 14, cmd: 15, d0: 2,  d1: 4,  d2: 12, d3: 13, width: 1 },
  esp32c6: { clk: 19, cmd: 18, d0: 20, d1: 21, d2: 22, d3: 23, width: 1 },
};

export function fsInitLines(sdmmc?: SdmmcSlotConfig | null, target?: string): string[] {
  const defaults = (target && SDMMC_DEFAULT_PINS[target]) || SDMMC_DEFAULT_PINS.esp32;
  // Merge user overrides onto the chip defaults: only fields the user sets are
  // overridden; unset pins keep the chip default. width defaults to 1.
  const slot: Required<SdmmcSlotConfig> = { ...defaults, ...(sdmmc ?? {}), width: sdmmc?.width ?? 1 };
  const width4 = slot.width === 4;

  // Emit slot.gpio_* overrides only for pins the user explicitly set; unset
  // pins are already correct in SDMMC_SLOT_CONFIG_DEFAULT(). This keeps the
  // generated code minimal and readable.
  const pinOverrides: string[] = [];
  const userSet = sdmmc ?? {};
  const emitPin = (field: keyof SdmmcSlotConfig, member: string): void => {
    if ((userSet as Record<string, unknown>)[field as string] !== undefined) {
      pinOverrides.push(`    slot.${member} = (gpio_num_t)${slot[field]};`);
    }
  };
  emitPin('clk', 'clk');
  emitPin('cmd', 'cmd');
  emitPin('d0', 'd0');
  if (width4) {
    emitPin('d1', 'd1');
    emitPin('d2', 'd2');
    emitPin('d3', 'd3');
  }
  const pinBlock = pinOverrides.length > 0 ? pinOverrides.join('\n') : '    // (using SDMMC_SLOT_CONFIG_DEFAULT pins)';

  return [
    `// CUTTLEFISH_FS_BEGIN`,
    `// ESP-IDF SD-card filesystem runtime shim. Mounts FAT on the SDMMC host,`,
    `// then exposes POSIX file helpers. Slot pins: clk=${slot.clk} cmd=${slot.cmd} d0=${slot.d0}${width4 ? ` d1=${slot.d1} d2=${slot.d2} d3=${slot.d3}` : ''} (width ${slot.width}).`,
    `static bool __tc_fs_mounted = false;`,
    ``,
    `static inline bool __tc_fs_begin(void) {`,
    `    if (__tc_fs_mounted) return true;`,
    `    sdmmc_host_t host = SDMMC_HOST_DEFAULT();`,
    width4 ? `    host.flags = SDMMC_HOST_FLAG_4BIT;` : `    host.flags = SDMMC_HOST_FLAG_1BIT;`,
    `    sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();`,
    pinBlock,
    `    esp_vfs_fat_sdmmc_mount_config_t mount_config = {`,
    `        .format_if_mount_failed = false,`,
    `        .max_files = 5,`,
    `        .allocation_unit_size = 16 * 1024,`,
    `    };`,
    `    sdmmc_card_t* card = NULL;`,
    `    esp_err_t ret = esp_vfs_fat_sdmmc_mount("/sdcard", &host, &slot, &mount_config, &card);`,
    `    if (ret != ESP_OK) {`,
    `        ESP_LOGE("tc", "SD mount failed: %s", esp_err_to_name(ret));`,
    `        return false;`,
    `    }`,
    `    __tc_fs_mounted = true;`,
    `    return true;`,
    `}`,
    ``,
    `// Read an entire file into a malloc'd, NUL-terminated buffer. Returns an`,
    `// empty string (static) on missing/unreadable files so callers can treat`,
    `// the result uniformly. The returned pointer for a real read is heap and`,
    `// must be freed by the caller (the runtime string-ownership layer does so).`,
    `static inline const char* __tc_fs_read_text(const char* path) {`,
    `    if (!__tc_fs_mounted && !__tc_fs_begin()) return "";`,
    `    FILE* f = fopen(path, "r");`,
    `    if (!f) return "";`,
    `    fseek(f, 0, SEEK_END);`,
    `    long sz = ftell(f);`,
    `    if (sz < 0) { fclose(f); return ""; }`,
    `    fseek(f, 0, SEEK_SET);`,
    `    char* buf = (char*)malloc((size_t)sz + 1);`,
    `    if (!buf) { fclose(f); return ""; }`,
    `    size_t got = fread(buf, 1, (size_t)sz, f);`,
    `    fclose(f);`,
    `    buf[got] = '\\0';`,
    `    return buf;`,
    `}`,
    ``,
    `static inline void __tc_fs_write_text(const char* path, const char* content) {`,
    `    if (!__tc_fs_mounted && !__tc_fs_begin()) return;`,
    `    FILE* f = fopen(path, "w");`,
    `    if (!f) return;`,
    `    fputs(content, f);`,
    `    fclose(f);`,
    `}`,
    ``,
    `static inline bool __tc_fs_exists(const char* path) {`,
    `    if (!__tc_fs_mounted && !__tc_fs_begin()) return false;`,
    `    struct stat st;`,
    `    return stat(path, &st) == 0;`,
    `}`,
    ``,
    `static inline bool __tc_fs_remove(const char* path) {`,
    `    if (!__tc_fs_mounted && !__tc_fs_begin()) return false;`,
    `    return unlink(path) == 0;`,
    `}`,
    `// CUTTLEFISH_FS_END`,
    ``,
  ];
}

/** Resolve a HAL fs.* op to ESP-IDF C++. */
export function lowerFs(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'fs.begin':
      return { code: '__tc_fs_begin();' };

    case 'fs.read_text':
      // Value-returning: the helper returns a heap char*. The string-ownership
      // layer treats this like other heap-string returns (wifi.ssid etc.).
      return { expression: `__tc_fs_read_text(${o.path})` };

    case 'fs.write_text':
      return { code: `__tc_fs_write_text(${o.path}, ${o.content});` };

    case 'fs.exists':
      return { expression: `__tc_fs_exists(${o.path})` };

    case 'fs.remove':
      return { expression: `__tc_fs_remove(${o.path})` };

    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
