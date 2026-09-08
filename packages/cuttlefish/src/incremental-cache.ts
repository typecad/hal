/**
 * Incremental transpilation cache for persistent file change detection.
 *
 * NOTE: This module is currently UNUSED. The transpile pipeline does not import
 * it because incremental builds were unsound: the pipeline wiped the cache and
 * the output directory before loading, and even on a partial rebuild it built
 * raw IR only for changed files, so cross-module metadata (enums, class field
 * types, accessors, function return types) was incomplete for unchanged graph
 * files. Re-enabling incremental builds safely requires rehydrating cached
 * IR/metadata for EVERY file in the graph before the aggregation passes in
 * transpile.ts, not just the changed ones.
 *
 * This module enables incremental builds by:
 * 1. Tracking file content hashes across sessions
 * 2. Detecting which files have changed
 * 3. Building dependency graphs to identify transitive changes
 * 4. Caching transpilation results for unchanged files
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Cache file version - increment when format changes
 */
const CACHE_VERSION = 1;

function computeToolchainFingerprint(): string {
  const candidates = [
    path.join(__dirname, "transpile.js"),
    path.join(__dirname, "transpile.ts"),
    path.join(__dirname, "emit", "cpp-emitter.js"),
    path.join(__dirname, "emit", "cpp-emitter.ts"),
    path.join(__dirname, "ir", "build-ir.js"),
    path.join(__dirname, "ir", "build-ir.ts"),
    path.join(__dirname, "ir", "ownership-analysis.js"),
    path.join(__dirname, "ir", "ownership-analysis.ts"),
    path.join(__dirname, "ir", "validation-orchestrator.js"),
    path.join(__dirname, "ir", "validation-orchestrator.ts"),
  ];

  const signature = candidates
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      return `${path.basename(filePath)}:${stat.size}:${stat.mtimeMs}`;
    })
    .join("|");

  return crypto.createHash("sha256").update(signature).digest("hex").slice(0, 16);
}

/**
 * File entry in the cache
 */
interface CachedFileEntry {
  /** Content hash (SHA-256, first 16 chars) */
  hash: string;
  /** Last modified timestamp (for quick checks) */
  mtime: number;
  /** File size in bytes */
  size: number;
  /** Dependencies (imported file paths) */
  dependencies: string[];
  /** Generated output paths */
  outputs: string[];
}

/**
 * Cache structure stored on disk
 */
interface IncrementalCacheData {
  version: number;
  toolchainFingerprint: string;
  /** Project root directory */
  rootDir: string;
  /** File entries keyed by resolved absolute path */
  files: Record<string, CachedFileEntry>;
  /** Cache creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Result of checking if a file needs retranspilation
 */
interface FileChangeStatus {
  filePath: string;
  /** Whether the file needs retranspilation */
  needsRetranspile: boolean;
  /** Reason for retranspilation */
  reason: "changed" | "new" | "dependency-changed" | "cache-miss" | "output-missing" | "none";
}

/**
 * Options for incremental cache
 */
interface IncrementalCacheOptions {
  /** Path to the cache file (default: .typecad-hal-cache.json in project root) */
  cachePath?: string;
  /** Project root directory */
  rootDir: string;
  /** Whether to enable incremental builds (default: true) */
  enabled?: boolean;
}

/**
 * Compute a hash of file content
 */
function computeFileHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Default cache file name
 */
const DEFAULT_CACHE_NAME = ".typecad-hal-cache.json";

/**
 * Incremental transpilation cache manager
 */
export class IncrementalCache {
  private cachePath: string;
  private rootDir: string;
  private enabled: boolean;
  private cache: IncrementalCacheData;
  private dirty = false;

  constructor(options: IncrementalCacheOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.cachePath = options.cachePath ?? path.join(this.rootDir, DEFAULT_CACHE_NAME);
    this.enabled = options.enabled ?? true;
    this.cache = this.load();
  }

  /**
   * Load cache from disk, or create empty cache
   */
  private load(): IncrementalCacheData {
    if (!this.enabled) {
      return this.createEmptyCache();
    }

    try {
      if (fs.existsSync(this.cachePath)) {
        const content = fs.readFileSync(this.cachePath, "utf8");
        const data = JSON.parse(content) as IncrementalCacheData;
        const currentToolchainFingerprint = computeToolchainFingerprint();
        
        // Validate cache version and root
        if (
          data.version === CACHE_VERSION &&
          data.toolchainFingerprint === currentToolchainFingerprint &&
          path.resolve(data.rootDir) === this.rootDir
        ) {
          return data;
        }
      }
    } catch (error) {
      if (process.env.TYPECAD_HAL_DEBUG) console.error("[incremental-cache] Corrupted cache file:", error);
    }

    return this.createEmptyCache();
  }

  /**
   * Create an empty cache structure
   */
  private createEmptyCache(): IncrementalCacheData {
    return {
      version: CACHE_VERSION,
      toolchainFingerprint: computeToolchainFingerprint(),
      rootDir: this.rootDir,
      files: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Save cache to disk (if dirty)
   */
  save(): void {
    if (!this.enabled || !this.dirty) {
      return;
    }

    this.cache.updatedAt = Date.now();
    
    try {
      // Ensure directory exists
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), "utf8");
      this.dirty = false;
    } catch (error) {
      if (process.env.TYPECAD_HAL_DEBUG) console.error("[incremental-cache] Failed to save cache:", error);
    }
  }

  /**
   * Check if a file has changed since last cache
   */
  hasFileChanged(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    const entry = this.cache.files[resolved];
    
    if (!entry) {
      return true; // New file
    }

    // Quick check: mtime and size
    try {
      const stat = fs.statSync(resolved);
      if (stat.mtimeMs !== entry.mtime || stat.size !== entry.size) {
        // Content might have changed, verify with hash
        const content = fs.readFileSync(resolved, "utf8");
        const hash = computeFileHash(content);
        return hash !== entry.hash;
      }
    } catch {
      return true; // File doesn't exist or error
    }

    return false;
  }

  /**
   * Check if a file's outputs still exist
   */
  outputsExist(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    const entry = this.cache.files[resolved];
    
    if (!entry || !entry.outputs.length) {
      return false;
    }

    return entry.outputs.every((output) => fs.existsSync(output));
  }

  /**
   * Get files that need retranspilation based on changes
   */
  getFilesNeedingRetranspile(filePaths: string[]): FileChangeStatus[] {
    const results: FileChangeStatus[] = [];
    const changedFiles = new Set<string>();
    const dependents = new Set<string>();

    // First pass: identify directly changed files
    for (const filePath of filePaths) {
      const resolved = path.resolve(filePath);
      const entry = this.cache.files[resolved];

      if (!entry) {
        changedFiles.add(resolved);
        results.push({
          filePath: resolved,
          needsRetranspile: true,
          reason: "new",
        });
      } else if (this.hasFileChanged(resolved)) {
        changedFiles.add(resolved);
        results.push({
          filePath: resolved,
          needsRetranspile: true,
          reason: "changed",
        });
      } else if (!this.outputsExist(resolved)) {
        changedFiles.add(resolved);
        results.push({
          filePath: resolved,
          needsRetranspile: true,
          reason: "output-missing",
        });
      } else {
        results.push({
          filePath: resolved,
          needsRetranspile: false,
          reason: "none",
        });
      }
    }

    // Build reverse dependency map (who depends on whom)
    const reverseDeps = new Map<string, Set<string>>();
    for (const [filePath, entry] of Object.entries(this.cache.files)) {
      for (const dep of entry.dependencies) {
        if (!reverseDeps.has(dep)) {
          reverseDeps.set(dep, new Set());
        }
        reverseDeps.get(dep)!.add(filePath);
      }
    }

    // Second pass: find transitive dependents of changed files
    const toProcess = [...changedFiles];
    while (toProcess.length > 0) {
      const changed = toProcess.pop()!;
      const dependentsOfChanged = reverseDeps.get(changed);
      
      if (dependentsOfChanged) {
        for (const dependent of dependentsOfChanged) {
          if (!changedFiles.has(dependent) && filePaths.includes(dependent)) {
            dependents.add(dependent);
            toProcess.push(dependent);
          }
        }
      }
    }

    // Update results for dependents
    for (const result of results) {
      if (dependents.has(result.filePath)) {
        result.needsRetranspile = true;
        result.reason = "dependency-changed";
      }
    }

    return results;
  }

  /**
   * Update cache entry for a file
   */
  updateFile(
    filePath: string,
    content: string,
    dependencies: string[],
    outputs: string[]
  ): void {
    const resolved = path.resolve(filePath);
    
    try {
      const stat = fs.statSync(resolved);
      const hash = computeFileHash(content);

      this.cache.files[resolved] = {
        hash,
        mtime: stat.mtimeMs,
        size: stat.size,
        dependencies: dependencies.map((d) => path.resolve(d)),
        outputs: outputs.map((o) => path.resolve(o)),
      };
      
      this.dirty = true;
    } catch {
      // File doesn't exist, skip caching
    }
  }

  /**
   * Remove a file from the cache
   */
  removeFile(filePath: string): void {
    const resolved = path.resolve(filePath);
    if (this.cache.files[resolved]) {
      delete this.cache.files[resolved];
      this.dirty = true;
    }
  }

  /**
   * Get cached outputs for a file (if valid)
   */
  getCachedOutputs(filePath: string): string[] | null {
    const resolved = path.resolve(filePath);
    const entry = this.cache.files[resolved];

    if (!entry || this.hasFileChanged(resolved) || !this.outputsExist(resolved)) {
      return null;
    }

    return entry.outputs;
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache = this.createEmptyCache();
    this.dirty = true;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    fileCount: number;
    cachePath: string;
    createdAt: number;
    updatedAt: number;
  } {
    return {
      fileCount: Object.keys(this.cache.files).length,
      cachePath: this.cachePath,
      createdAt: this.cache.createdAt,
      updatedAt: this.cache.updatedAt,
    };
  }

  /**
   * Check if incremental caching is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Global incremental cache instance (lazy-initialized)
 */
let globalCache: IncrementalCache | null = null;

/**
 * Initialize the global incremental cache
 */
export function initIncrementalCache(options: IncrementalCacheOptions): IncrementalCache {
  globalCache = new IncrementalCache(options);
  return globalCache;
}

/**
 * Get the global incremental cache (must be initialized first)
 */
export function getIncrementalCache(): IncrementalCache | null {
  return globalCache;
}

/**
 * Save and clear the global incremental cache
 */
export function saveAndClearIncrementalCache(): void {
  if (globalCache) {
    globalCache.save();
    globalCache = null;
  }
}
