import ts from "typescript";
import path from "path";
import fs from "fs";
import { clearAllProfileCaches } from "./platform/registry.js";

export class TranspileCache {
  private readonly npmPackageCache = new Map<string, string | undefined>();
  private readonly packageJsonCache = new Map<string, Record<string, unknown> | null>();
  private readonly sourceFileCache = new Map<string, ts.SourceFile>();
  private readonly fileExistsCache = new Map<string, boolean>();
  private readonly fileContentCache = new Map<string, string>();

  clear(): void {
    this.npmPackageCache.clear();
    this.packageJsonCache.clear();
    this.sourceFileCache.clear();
    this.fileExistsCache.clear();
    this.fileContentCache.clear();
    clearAllProfileCaches();
  }

  getCachedNpmPackage(fromFile: string, packageName: string): string | undefined {
    return this.npmPackageCache.get(`${fromFile}|${packageName}`);
  }

  setCachedNpmPackage(fromFile: string, packageName: string, packageDir: string | undefined): void {
    this.npmPackageCache.set(`${fromFile}|${packageName}`, packageDir);
  }

  getCachedPackageJson(packageDir: string): Record<string, unknown> | null | undefined {
    return this.packageJsonCache.get(packageDir);
  }

  setCachedPackageJson(packageDir: string, content: Record<string, unknown> | null): void {
    this.packageJsonCache.set(packageDir, content);
  }

  getOrParseSourceFile(filePath: string, sourceText: string): ts.SourceFile {
    const cached = this.sourceFileCache.get(filePath);
    if (cached) return cached;

    const extension = path.extname(filePath).toLowerCase();
    const source = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      extension === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    this.sourceFileCache.set(filePath, source);
    return source;
  }

  cachedFileExists(filePath: string): boolean {
    const cached = this.fileExistsCache.get(filePath);
    if (cached !== undefined) return cached;

    const exists = fs.existsSync(filePath);
    this.fileExistsCache.set(filePath, exists);
    return exists;
  }

  cachedIsFile(filePath: string): boolean {
    const cacheKey = `file:${filePath}`;
    const cached = this.fileExistsCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    this.fileExistsCache.set(cacheKey, exists);
    return exists;
  }

  getOrReadFile(filePath: string): string {
    const cached = this.fileContentCache.get(filePath);
    if (cached !== undefined) return cached;

    const content = fs.readFileSync(filePath, "utf8");
    this.fileContentCache.set(filePath, content);
    return content;
  }
}

const defaultCache = new TranspileCache();

export function clearCaches(): void {
  defaultCache.clear();
}

export function getCachedNpmPackage(fromFile: string, packageName: string): string | undefined {
  return defaultCache.getCachedNpmPackage(fromFile, packageName);
}

export function setCachedNpmPackage(fromFile: string, packageName: string, packageDir: string | undefined): void {
  defaultCache.setCachedNpmPackage(fromFile, packageName, packageDir);
}

export function getCachedPackageJson(packageDir: string): Record<string, unknown> | null | undefined {
  return defaultCache.getCachedPackageJson(packageDir);
}

export function setCachedPackageJson(packageDir: string, content: Record<string, unknown> | null): void {
  defaultCache.setCachedPackageJson(packageDir, content);
}

export function getOrParseSourceFile(filePath: string, sourceText: string): ts.SourceFile {
  return defaultCache.getOrParseSourceFile(filePath, sourceText);
}

export function cachedFileExists(filePath: string): boolean {
  return defaultCache.cachedFileExists(filePath);
}

export function cachedIsFile(filePath: string): boolean {
  return defaultCache.cachedIsFile(filePath);
}

export function getOrReadFile(filePath: string): string {
  return defaultCache.getOrReadFile(filePath);
}
