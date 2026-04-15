// ---------------------------------------------------------------------------
// File watcher for automatic retranspilation on source changes
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

/** Debounce interval in milliseconds to collapse rapid file events. */
const DEBOUNCE_MS = 150;

/**
 * Options for the watch mode runner.
 */
export interface WatchOptions {
  /** Directories to watch recursively. */
  watchDirs: string[];
  /** Path to typecode.config.ts (if any) — watched for changes. */
  configPath?: string;
  /** Directory containing the entry file — used for relevance filtering. */
  entryDir: string;
  /** Callback invoked on each relevant file change. */
  onRebuild: (changedFile: string) => Promise<void>;
  /** Callback invoked once after watchers are set up. */
  onReady?: () => void;
}

/**
 * Discover directories that should be watched for a given entry file and
 * optional config path.  Returns unique, resolved directory paths.
 */
export function discoverWatchDirs(entryFile: string, configPath?: string): string[] {
  const dirs = new Set<string>();

  // Always watch the entry file's directory tree
  dirs.add(path.dirname(path.resolve(entryFile)));

  // Also watch the config file's directory if it lives elsewhere
  if (configPath) {
    dirs.add(path.dirname(path.resolve(configPath)));
  }

  return [...dirs];
}

/**
 * Determine whether a file change event is relevant and should trigger a
 * rebuild.
 *
 * A change is relevant when the file is:
 * - The `typecode.config.ts` file, OR
 * - A `.ts` file (but NOT a `.d.ts` declaration) that is NOT inside
 *   `node_modules`
 */
export function isRelevantChange(
  changedPath: string,
  _entryDir: string,
  configPath?: string,
): boolean {
  const resolved = path.resolve(changedPath);
  const ext = path.extname(resolved).toLowerCase();

  // Config file change — always relevant
  if (configPath && resolved === path.resolve(configPath)) {
    return true;
  }

  // Only .ts files beyond this point
  if (ext !== ".ts") {
    return false;
  }

  // Skip auto-generated .d.ts declarations
  if (resolved.endsWith(".d.ts")) {
    return false;
  }

  // Skip anything inside node_modules
  if (resolved.includes(`${path.sep}node_modules${path.sep}`)) {
    return false;
  }

  return true;
}

/**
 * Start the file watcher loop.  Sets up `fs.watch` listeners on each of the
 * supplied `watchDirs`, debounces rapid events, and invokes `onRebuild` for
 * relevant changes.
 *
 * This function **never resolves** under normal operation — it keeps the
 * process alive until the user presses Ctrl+C.
 */
export async function runWatch(options: WatchOptions): Promise<void> {
  const { watchDirs, configPath, entryDir, onRebuild, onReady } = options;

  const watchers: fs.FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let rebuilding = false;

  // ---- Debounced rebuild scheduler ----------------------------------------

  const scheduleRebuild = (changedFile: string): void => {
    if (!isRelevantChange(changedFile, entryDir, configPath)) {
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      if (rebuilding) return;

      rebuilding = true;
      try {
        await onRebuild(changedFile);
      } finally {
        rebuilding = false;
      }
    }, DEBOUNCE_MS);
  };

  // ---- Start watchers -----------------------------------------------------

  for (const dir of watchDirs) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        scheduleRebuild(path.join(dir, filename));
      });
      watchers.push(watcher);
    } catch {
      // Directory might not exist or recursive watch unsupported on this platform
    }
  }

  // Signal readiness
  onReady?.();

  // ---- Graceful shutdown on Ctrl+C ----------------------------------------

  const onSigInt = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    for (const w of watchers) {
      w.close();
    }
    console.log();
    console.log("  Watch stopped.");
    process.exit(0);
  };

  process.on("SIGINT", onSigInt);

  // Return a promise that never resolves so the caller can `await` this
  // function and block the main thread indefinitely.  The fs.watch listeners
  // keep the Node.js event loop alive.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  return new Promise<void>(() => {});
}
