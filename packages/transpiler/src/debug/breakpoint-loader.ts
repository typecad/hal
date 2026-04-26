// ---------------------------------------------------------------------------
// @typecode/debug — Breakpoint Loader
//
// Loads breakpoint data from .typecode/breakpoints.json, which is written
// by the VS Code extension when users set breakpoints.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import type { BreakpointMap, RichBreakpoint, LegacyBreakpointMap } from './types';

/**
 * Default directory for TypeCode debug files.
 */
export const TYPECODE_DIR = '.typecode';

/**
 * Default filename for breakpoint data.
 */
export const BREAKPOINTS_FILE = 'breakpoints.json';

/**
 * Find the .typecode directory by walking up from the given directory.
 */
export function findTypecodeDir(startDir: string): string | undefined {
  let currentDir = path.resolve(startDir);
  
  while (currentDir !== path.dirname(currentDir)) {
    const typecodeDir = path.join(currentDir, TYPECODE_DIR);
    if (fs.existsSync(typecodeDir) && fs.statSync(typecodeDir).isDirectory()) {
      return typecodeDir;
    }
    currentDir = path.dirname(currentDir);
  }
  
  // Check root level
  const rootTypecodeDir = path.join(currentDir, TYPECODE_DIR);
  if (fs.existsSync(rootTypecodeDir) && fs.statSync(rootTypecodeDir).isDirectory()) {
    return rootTypecodeDir;
  }
  
  return undefined;
}

/**
 * Load breakpoints from .typecode/breakpoints.json.
 * 
 * @param sourceDir The directory containing the source file (or any directory in the project)
 * @returns BreakpointMap or undefined if no breakpoints file exists
 */
export function loadBreakpoints(sourceDir: string): BreakpointMap | undefined {
  const typecodeDir = findTypecodeDir(sourceDir);
  if (!typecodeDir) {
    return undefined;
  }
  
  const breakpointsPath = path.join(typecodeDir, BREAKPOINTS_FILE);
  if (!fs.existsSync(breakpointsPath)) {
    return undefined;
  }
  
  try {
    const content = fs.readFileSync(breakpointsPath, 'utf-8');
    const data = JSON.parse(content);
    
    // Handle VS Code extension format: { "breakpoints": [...] }
    if (data.breakpoints && Array.isArray(data.breakpoints)) {
      const map: BreakpointMap = {};
      for (const bp of data.breakpoints) {
        const file = bp.file as string;
        if (file && bp.line) {
          if (!map[file]) {
            map[file] = [];
          }
          map[file].push({
            file,
            line: bp.line,
            condition: bp.condition,
            logMessage: bp.logMessage,
          });
        }
      }
      return map;
    }
    
    // Handle direct array format: [...]
    if (Array.isArray(data)) {
      const map: BreakpointMap = {};
      for (const bp of data) {
        const file = bp.file as string;
        if (file && bp.line) {
          if (!map[file]) {
            map[file] = [];
          }
          map[file].push({
            file,
            line: bp.line,
            condition: bp.condition,
            logMessage: bp.logMessage,
          });
        }
      }
      return map;
    }
    
    // Handle legacy format: { "example.ts": [10, 15] }
    // Convert to rich breakpoint format
    const legacy = data as LegacyBreakpointMap;
    const map: BreakpointMap = {};
    for (const [file, lines] of Object.entries(legacy)) {
      if (Array.isArray(lines)) {
        map[file] = lines.map(line => ({
          file,
          line: typeof line === 'number' ? line : (line as RichBreakpoint).line,
          condition: typeof line === 'object' ? (line as RichBreakpoint).condition : undefined,
          logMessage: typeof line === 'object' ? (line as RichBreakpoint).logMessage : undefined,
        }));
      }
    }
    return map;
  } catch (error) {
    console.warn(`Warning: Failed to parse ${breakpointsPath}: ${error}`);
    return undefined;
  }
}

/**
 * Normalize a file path for matching against breakpoint keys.
 * Handles both absolute and relative paths.
 */
export function normalizeFilePath(filePath: string, projectRoot?: string): string {
  // Get just the filename if no project root
  if (!projectRoot) {
    return path.basename(filePath);
  }
  
  // Make path relative to project root
  const absolutePath = path.resolve(filePath);
  const absoluteRoot = path.resolve(projectRoot);
  
  if (absolutePath.startsWith(absoluteRoot)) {
    return path.relative(absoluteRoot, absolutePath);
  }
  
  return path.basename(filePath);
}

/**
 * Get rich breakpoints for a specific file from the BreakpointMap.
 * 
 * @param breakpoints The breakpoint map
 * @param fileName The file path to look up
 * @returns Array of RichBreakpoint objects for the file
 */
export function getBreakpointsForFile(
  breakpoints: BreakpointMap,
  fileName: string
): RichBreakpoint[] {
  // Try exact match first
  if (breakpoints[fileName]) {
    return breakpoints[fileName];
  }
  
  // Try basename match
  const basename = path.basename(fileName);
  if (breakpoints[basename]) {
    return breakpoints[basename];
  }
  
  // Try matching against any key that ends with the filename
  for (const key of Object.keys(breakpoints)) {
    if (key.endsWith(basename) || fileName.endsWith(key)) {
      return breakpoints[key];
    }
  }
  
  return [];
}
