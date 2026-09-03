import fs from "node:fs";
import path from "node:path";

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

// Paths written (or confirmed identical) via writeText since the last
// resetWrittenFiles() call. The transpiler uses this to sweep stale generated
// sources from the out dir — files left behind by renamed entries or removed
// source modules that a downstream glob (e.g. Zephyr's CMakeLists
// `file(GLOB src/*.cpp)`) would otherwise compile, producing duplicate-symbol
// link errors.
const writtenFiles = new Set<string>();

export function resetWrittenFiles(): void {
  writtenFiles.clear();
}

export function wasWrittenThisRun(filePath: string): boolean {
  return writtenFiles.has(path.resolve(filePath));
}

export function writeText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const resolved = path.resolve(filePath);
  // Skip writing when content is identical — preserves mtime so downstream
  // build tools (west/ninja, make) can skip recompilation.
  // The file still counts as "written this run" (it is current output).
  writtenFiles.add(resolved);
  try {
    if (fs.readFileSync(filePath, "utf8") === content) return;
  } catch {
    // File doesn't exist yet — fall through to write.
  }
  fs.writeFileSync(filePath, content, "utf8");
}

export function listFiles(dirPath: string, extension: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(extension.toLowerCase()))
    .map((name) => path.join(dirPath, name));
}

/**
 * Recursive variant of {@link listFiles}. Walks `dirPath` depth-first and
 * returns every file (in every subdirectory) whose name ends with `extension`.
 *
 * Used by {@link loadLibraryDefinitions} so libdefs in project subdirectories
 * are discovered. Purely additive vs. the non-recursive `listFiles` —
 * single-level layouts keep working, nested layouts now also work.
 *
 * Returns absolute paths. Unreadable directories are silently skipped
 * (matches `listFiles`'s not-exist behavior for non-existent roots).
 */
export function listFilesRecursive(dirPath: string, extension: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const ext = extension.toLowerCase();
  const out: string[] = [];
  const stack: string[] = [dirPath];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      // Permission error / race / etc. Skip this subtree.
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
        out.push(full);
      }
    }
  }
  return out;
}
