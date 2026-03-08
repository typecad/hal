/**
 * Caching utilities for transpilation performance optimization.
 * 
 * This module provides session-scoped caches that live for the duration
 * of a single transpileFile() call, avoiding redundant I/O and parsing.
 */

import ts from "typescript";
import path from "path";

/**
 * Cache for resolved npm package paths.
 * Key: `${fromFile}|${packageName}`
 */
const npmPackageCache = new Map<string, string | undefined>();

/**
 * Cache for package.json contents.
 * Key: package directory path
 */
const packageJsonCache = new Map<string, Record<string, unknown> | null>();

/**
 * Cache for parsed TypeScript source files.
 * Key: resolved file path
 */
const sourceFileCache = new Map<string, ts.SourceFile>();

/**
 * Cache for file existence checks.
 * Key: resolved file path
 */
const fileExistsCache = new Map<string, boolean>();

/**
 * Cache for file content.
 * Key: resolved file path
 */
const fileContentCache = new Map<string, string>();

/**
 * Clear all caches. Call at the start of each transpileFile() call.
 */
export function clearCaches(): void {
  npmPackageCache.clear();
  packageJsonCache.clear();
  sourceFileCache.clear();
  fileExistsCache.clear();
  fileContentCache.clear();
}

// ============================================
// NPM Package Resolution Cache
// ============================================

/**
 * Get cached npm package directory path.
 */
export function getCachedNpmPackage(fromFile: string, packageName: string): string | undefined {
  const key = `${fromFile}|${packageName}`;
  return npmPackageCache.get(key);
}

/**
 * Cache npm package directory path.
 */
export function setCachedNpmPackage(fromFile: string, packageName: string, packageDir: string | undefined): void {
  const key = `${fromFile}|${packageName}`;
  npmPackageCache.set(key, packageDir);
}

// ============================================
// Package.json Cache
// ============================================

/**
 * Get cached package.json contents.
 */
export function getCachedPackageJson(packageDir: string): Record<string, unknown> | null | undefined {
  return packageJsonCache.get(packageDir);
}

/**
 * Cache package.json contents.
 */
export function setCachedPackageJson(packageDir: string, content: Record<string, unknown> | null): void {
  packageJsonCache.set(packageDir, content);
}

// ============================================
// Source File Cache
// ============================================

/**
 * Get cached TypeScript source file, or parse and cache it.
 */
export function getOrParseSourceFile(
  filePath: string,
  sourceText: string
): ts.SourceFile {
  const cached = sourceFileCache.get(filePath);
  if (cached) {
    return cached;
  }

  const extension = path.extname(filePath).toLowerCase();
  const source = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    extension === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  sourceFileCache.set(filePath, source);
  return source;
}

// ============================================
// File Existence Cache
// ============================================

/**
 * Cached file existence check.
 */
export function cachedFileExists(filePath: string): boolean {
  const cached = fileExistsCache.get(filePath);
  if (cached !== undefined) {
    return cached;
  }
  
  const fs = require("fs");
  const exists = fs.existsSync(filePath);
  fileExistsCache.set(filePath, exists);
  return exists;
}

/**
 * Cached file existence check with file type validation.
 */
export function cachedIsFile(filePath: string): boolean {
  const cacheKey = `file:${filePath}`;
  const cached = fileExistsCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  
  const fs = require("fs");
  const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  fileExistsCache.set(cacheKey, exists);
  return exists;
}

// ============================================
// File Content Cache
// ============================================

/**
 * Get cached file content, or read and cache it.
 */
export function getOrReadFile(filePath: string): string {
  const cached = fileContentCache.get(filePath);
  if (cached !== undefined) {
    return cached;
  }

  const fs = require("fs");
  const content = fs.readFileSync(filePath, "utf8");
  fileContentCache.set(filePath, content);
  return content;
}

// ============================================
// Cache Statistics (for debugging)
// ============================================

export interface CacheStats {
  npmPackageHits: number;
  npmPackageMisses: number;
  packageJsonHits: number;
  packageJsonMisses: number;
  sourceFileHits: number;
  sourceFileMisses: number;
  fileExistsHits: number;
  fileExistsMisses: number;
}

/**
 * Get cache statistics for debugging/performance analysis.
 */
export function getCacheStats(): CacheStats {
  return {
    npmPackageHits: 0, // Would need hit counters for accurate stats
    npmPackageMisses: 0,
    packageJsonHits: 0,
    packageJsonMisses: 0,
    sourceFileHits: 0,
    sourceFileMisses: 0,
    fileExistsHits: 0,
    fileExistsMisses: 0,
  };
}

/**
 * Get cache sizes for debugging.
 */
export function getCacheSizes(): {
  npmPackage: number;
  packageJson: number;
  sourceFile: number;
  fileExists: number;
  fileContent: number;
} {
  return {
    npmPackage: npmPackageCache.size,
    packageJson: packageJsonCache.size,
    sourceFile: sourceFileCache.size,
    fileExists: fileExistsCache.size,
    fileContent: fileContentCache.size,
  };
}