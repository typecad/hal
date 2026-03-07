/**
 * Arduino Library Utilities
 * 
 * Handles discovery and .d.ts generation for Arduino libraries installed via arduino-cli.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { generateDeclFromCpp } from "./libdef/cpp-to-decl";

/**
 * Information about an installed Arduino library
 */
export interface ArduinoLibrary {
  /** Library name (e.g., "BH1750") */
  name: string;
  /** Version string */
  version?: string;
  /** Path to the library directory */
  path: string;
  /** Author information */
  author?: string;
  /** Brief description */
  sentence?: string;
}

/**
 * Result from arduino-cli lib list --format json
 */
interface ArduinoCliLibrary {
  name: string;
  version?: string;
  install_dir?: string;
  author?: string;
  sentence?: string;
}

/**
 * Cache for installed Arduino libraries
 */
let libraryCache: Map<string, ArduinoLibrary> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Execute arduino-cli and return parsed JSON output
 */
function runArduinoCli(args: string[]): unknown | null {
  try {
    const result = spawnSync("arduino-cli", args, {
      encoding: "utf8",
      timeout: 30000,
    });

    if (result.status !== 0) {
      return null;
    }

    const output = result.stdout?.trim();
    if (!output) {
      return null;
    }

    return JSON.parse(output);
  } catch {
    return null;
  }
}

/**
 * Get all installed Arduino libraries using arduino-cli
 */
export function getInstalledLibraries(): Map<string, ArduinoLibrary> {
  // Check cache
  const now = Date.now();
  if (libraryCache && (now - cacheTimestamp) < CACHE_TTL) {
    return libraryCache;
  }

  const libraries = new Map<string, ArduinoLibrary>();

  // Run arduino-cli lib list --format json
  const result = runArduinoCli(["lib", "list", "--format", "json"]);
  
  if (!result || !Array.isArray(result)) {
    libraryCache = libraries;
    cacheTimestamp = now;
    return libraries;
  }

  for (const lib of result as ArduinoCliLibrary[]) {
    if (!lib.name || !lib.install_dir) {
      continue;
    }

    const library: ArduinoLibrary = {
      name: lib.name,
      version: lib.version,
      path: lib.install_dir,
      author: lib.author,
      sentence: lib.sentence,
    };

    // Store by name (case-insensitive key)
    libraries.set(lib.name.toLowerCase(), library);
    // Also store with original casing
    if (lib.name !== lib.name.toLowerCase()) {
      libraries.set(lib.name, library);
    }
  }

  libraryCache = libraries;
  cacheTimestamp = now;
  return libraries;
}

/**
 * Find an Arduino library by name
 */
export function findArduinoLibrary(name: string): ArduinoLibrary | undefined {
  const libraries = getInstalledLibraries();
  
  // Try exact match first, then case-insensitive
  return libraries.get(name) || libraries.get(name.toLowerCase());
}

/**
 * Find the main header file for an Arduino library
 * Arduino libraries typically have a .h file matching the library name
 */
export function findLibraryHeader(library: ArduinoLibrary): string | undefined {
  const libName = library.name;
  const libDir = library.path;

  if (!fs.existsSync(libDir)) {
    return undefined;
  }

  // Common header locations:
  // 1. LibraryName.h in root
  // 2. src/LibraryName.h
  // 3. Any .h file in root if only one exists
  
  const candidates = [
    path.join(libDir, `${libName}.h`),
    path.join(libDir, "src", `${libName}.h`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  // Fallback: look for any .h file in the root or src directory
  const dirs = [libDir, path.join(libDir, "src")];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    
    const headers: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".h")) {
        headers.push(path.join(dir, entry.name));
      }
    }
    
    // If there's only one header, use it
    if (headers.length === 1) {
      return headers[0];
    }
    
    // If there are multiple, prefer one matching the library name
    for (const h of headers) {
      if (path.basename(h, ".h").toLowerCase() === libName.toLowerCase()) {
        return h;
      }
    }
  }

  return undefined;
}

/**
 * Find all source files (.h, .cpp) for an Arduino library
 */
export function findLibrarySources(library: ArduinoLibrary): { headers: string[]; cpps: string[] } {
  const libDir = library.path;
  const headers: string[] = [];
  const cpps: string[] = [];

  if (!fs.existsSync(libDir)) {
    return { headers, cpps };
  }

  // Search directories: root, src
  const searchDirs = [libDir, path.join(libDir, "src")];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;

      const fullPath = path.join(dir, entry.name);
      const lower = entry.name.toLowerCase();

      if (lower.endsWith(".h")) {
        headers.push(fullPath);
      } else if (lower.endsWith(".cpp")) {
        cpps.push(fullPath);
      }
    }
  }

  return { headers, cpps };
}

/**
 * Check if a module specifier looks like an Arduino library import
 * Arduino library imports are bare names like "BH1750", "Servo", "Wire"
 * (not relative paths, not npm packages)
 */
export function isArduinoLibraryImport(moduleSpecifier: string): boolean {
  // Skip relative imports
  if (moduleSpecifier.startsWith(".")) {
    return false;
  }

  // Skip npm-style imports (scoped or with path separators)
  if (moduleSpecifier.startsWith("@") || moduleSpecifier.includes("/")) {
    return false;
  }

  // Skip known non-Arduino imports
  const skipList = new Set([
    "typecode",
    "typescript",
    "node",
    "fs",
    "path",
    "http",
    "https",
    "crypto",
    "os",
    "util",
  ]);
  
  if (skipList.has(moduleSpecifier.toLowerCase())) {
    return false;
  }

  return true;
}

/**
 * Output directory for generated Arduino library declarations
 */
function getArduinoLibDeclDir(): string {
  // Use a global cache directory for Arduino library declarations
  // This allows sharing between projects
  const homeDir = process.env.USERPROFILE || process.env.HOME || ".";
  return path.join(homeDir, ".typecode", "arduino-libs");
}

/**
 * Generate a .d.ts file for an Arduino library
 * Returns the path to the generated file, or undefined if generation failed
 */
export function generateArduinoLibDecl(library: ArduinoLibrary): string | undefined {
  // Find the main header file
  const headerPath = findLibraryHeader(library);
  if (!headerPath) {
    console.log(`  No header file found for Arduino library '${library.name}'`);
    return undefined;
  }

  // Generate declaration from the header
  const declPath = generateDeclFromCpp(headerPath);
  return declPath;
}

/**
 * Try to generate .d.ts for a missing Arduino library import
 * Returns the path to the generated declaration file, or undefined if not found
 */
export function tryGenerateArduinoLibDecl(
  moduleSpecifier: string,
  fromFile: string
): string | undefined {
  // Check if this looks like an Arduino library import
  if (!isArduinoLibraryImport(moduleSpecifier)) {
    return undefined;
  }

  // Find the library
  const library = findArduinoLibrary(moduleSpecifier);
  if (!library) {
    return undefined;
  }

  console.log(`\n  Found Arduino library '${library.name}' at: ${library.path}`);
  
  // Generate the declaration
  const declPath = generateArduinoLibDecl(library);
  
  if (declPath) {
    console.log(`  Generated declaration: ${declPath}`);
    console.log(`  Review the generated types and adjust if needed.\n`);
  }

  return declPath;
}

/**
 * Clear the library cache (useful for testing or after installing new libraries)
 */
export function clearLibraryCache(): void {
  libraryCache = null;
  cacheTimestamp = 0;
}