/**
 * FSClass provides a high-level abstraction for filesystem operations.
 *
 * Lowered to native filesystem HAL ops (fs.*): ESP-IDF mounts an SD card via
 * esp_vfs_fat_sdmmc_mount (FAT on SDMMC/SDSPI); Arduino uses SD.h / LittleFS.
 * The per-framework runtime shim owns the open/read/write/close dance and
 * returns heap strings for readText.
 *
 * The semantic primitives (fsBegin / fsReadText / ...) are resolved to fs.*
 * HAL ops by the transpiler's hal-plugins switch; this class is the
 * ergonomic, type-checking surface.
 */
export class FSClass {
  static readonly __instance_name = "FS";

  /** Mount the filesystem. Returns true on success. */
  begin(): boolean {
    fsBegin();
    return true;
  }

  /** Read a UTF-8 text file into a string. Returns "" if the file is missing
   *  or unreadable. The returned buffer is caller-owned. */
  readText(path: string): string {
    return fsReadText(path);
  }

  /** Write a string to a file (overwrites). Silently no-ops if the file
   *  cannot be opened for writing. */
  writeText(path: string, content: string): void {
    fsWriteText(path, content);
  }

  /** True if a file exists at the path. */
  exists(path: string): boolean {
    return fsExists(path);
  }

  /** Delete a file. Returns true if deleted. */
  remove(path: string): boolean {
    return fsRemove(path);
  }
}

export const FS = new FSClass();

// ── Semantic primitives (resolved to fs.* HAL ops by the transpiler) ──
// These are inert at runtime (tests, type-checking); the cuttlefish transpiler
// intercepts calls by name and lowers them to typed HAL op IR.
export function fsBegin(): void {}
export function fsReadText(path: string): string { return ""; }
export function fsWriteText(path: string, content: string): void {}
export function fsExists(path: string): boolean { return false; }
export function fsRemove(path: string): boolean { return false; }
