/**
 * Include resolution utilities for C++ code emission.
 * Handles import resolution, SDK detection, and header normalization.
 * Extracted from cpp-emitter.ts
 */

import path from "node:path";
import fs from "node:fs";
import type { ResolvedNpmPackage } from "../../transpile/resolution.js";

/**
 * Checks if a module specifier resolves to a TypeCAD SDK path.
 * Cuttlefish SDK files (code/core/*, code/board-*, @typecad/* packages) are 
 * type-level only and should produce no C++ output or #include directives.
 * 
 * @param moduleSpecifier The import specifier (e.g., "@typecad/hal" or "./pins")
 * @param fromFile The file path from which the import originates
 * @returns true if this is a TypeCAD SDK import
 */
export function isCuttlefishSDKImport(moduleSpecifier: string, fromFile: string): boolean {
  // All @typecad/* package imports — including the `@typecad/hal` virtual
  // import, which resolves to the board package — are type-level only and must
  // not emit a C++ #include. Compare case-insensitively so the documented
  // mixed-case form is treated identically.
  const spec = moduleSpecifier.toLowerCase();
  if (spec.startsWith("@typecad/")) {
    return true;
  }

  // Check for relative imports to code/core or code/board-* paths
  if (!moduleSpecifier.startsWith(".")) {
    return false;
  }
  const basePath = path.resolve(path.dirname(fromFile), moduleSpecifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const normalized = candidate.replace(/\\/g, "/");
      if (/\/code\/core\//.test(normalized) || /\/code\/board-/.test(normalized)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Normalizes an include path to proper C++ include format.
 * 
 * @param include The include path (e.g., "Arduino.h" or "<vector>")
 * @returns Properly formatted include (e.g., "<Arduino.h>" or "<vector>")
 */
export function normalizeInclude(include: string): string {
  if (include.startsWith("<") || include.startsWith("\"")) {
    return include;
  }
  return `<${include}>`;
}

/**
 * Deduplicates an array while preserving order.
 * 
 * @param items The array to deduplicate
 * @returns A new array with duplicates removed
 */
export function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * Result of resolving a transpiled module include.
 */
interface TranspiledIncludeResult {
  /** The include path (e.g., "\"./pins.h\"") or empty string if not transpiled */
  include: string;
  /** Whether this import was resolved as a transpiled npm package */
  isTranspiled: boolean;
}

/**
 * Resolves an import to a local header file if it's from a transpiled npm package.
 * 
 * @param moduleSpecifier The import specifier
 * @param npmPackages Map of source paths to npm package info
 * @param fromFilePath The file path from which the import originates
 * @returns Information about the resolved include
 */
export function resolveTranspiledModuleInclude(
  moduleSpecifier: string,
  npmPackages: Map<string, ResolvedNpmPackage> | undefined,
  fromFilePath: string
): TranspiledIncludeResult {
  if (!npmPackages || npmPackages.size === 0) {
    return { include: "", isTranspiled: false };
  }

  if (moduleSpecifier.startsWith(".")) {
    const normalizedSpecifier = moduleSpecifier.endsWith(".js")
      ? `${moduleSpecifier.slice(0, -3)}.ts`
      : moduleSpecifier.endsWith(".mjs")
        ? `${moduleSpecifier.slice(0, -4)}.ts`
        : moduleSpecifier;

    const basePath = path.resolve(path.dirname(fromFilePath), normalizedSpecifier);
    const candidates = [
      basePath,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      path.join(basePath, "index.ts"),
      path.join(basePath, "index.tsx"),
    ].map((candidate) => path.resolve(candidate));

    for (const candidate of candidates) {
      const pkg = npmPackages.get(candidate);
      if (!pkg) {
        continue;
      }
      const currentPkg = npmPackages.get(path.resolve(fromFilePath));
      let headerName = `${pkg.moduleKey}.h`;
      if (currentPkg) {
        const currentDir = path.posix.dirname(currentPkg.moduleKey.replace(/\\/g, "/"));
        const targetPath = `${pkg.moduleKey.replace(/\\/g, "/")}.h`;
        let relativeHeader = path.posix.relative(currentDir, targetPath);
        if (!relativeHeader.startsWith(".")) {
          relativeHeader = `./${relativeHeader}`;
        }
        headerName = relativeHeader;
      }
      return { include: `"${headerName}"`, isTranspiled: true };
    }

    return { include: "", isTranspiled: false };
  }
  
  // Parse the module specifier to get package name and subpath
  const parts = moduleSpecifier.split("/");
  let packageName: string;
  let subpath: string;
  
  if (moduleSpecifier.startsWith("@")) {
    packageName = parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
    subpath = parts.length > 2 ? parts.slice(2).join("/") : "";
  } else {
    packageName = parts[0];
    subpath = parts.length > 1 ? parts.slice(1).join("/") : "";
  }
  
  // Look for a matching npm package in our transpiled modules
  // The npmPackages map is keyed by source path, so we need to iterate
  for (const [sourcePath, pkg] of npmPackages) {
    // Match by package name (e.g., "@typecad/hal" or "cuttlefish-implementation")
    if (pkg.packageName === packageName) {
      // Use the moduleKey from the package info, which is already computed
      const headerName = `${pkg.moduleKey}.h`;
      return { include: `"${headerName}"`, isTranspiled: true };
    }
  }
  
  return { include: "", isTranspiled: false };
}

/**
 * Applies a symbol map to a callee string.
 * Transforms root identifiers according to the mapping.
 * 
 * @param callee The original callee (e.g., "console.log" or "myFunc")
 * @param symbolMap Map of original names to transformed names
 * @returns The transformed callee
 */
export function applySymbolMap(callee: string, symbolMap: Record<string, string>): string {
  const firstDot = callee.indexOf(".");
  if (firstDot === -1) {
    return symbolMap[callee] ?? callee;
  }

  const root = callee.slice(0, firstDot);
  const rest = callee.slice(firstDot);
  return `${symbolMap[root] ?? root}${rest}`;
}