import path from "node:path";
import fs from "node:fs";
import { GeneratedSourceMap, MappedDiagnostic, SourceMapEntry } from "../types.js";
import { readText, writeText } from "../utils/fs.js";

function toSourceMapPath(generatedFilePath: string): string {
  return `${generatedFilePath}.thcppmap.json`;
}

/**
 * Normalize a file path for comparison across the emitter and g++.
 * g++ on Windows may emit paths that differ from what the emitter wrote:
 * drive-letter casing (C:\ vs c:\), forward vs back slashes, and trailing
 * differences. We normalize separators to "/", lowercase the drive letter
 * only (Windows is case-insensitive but the rest of a path may be
 * significant on POSIX), and resolve relatives.
 */
function normalizeFilePath(filePath: string): string {
  let p = path.resolve(filePath);
  // Normalize separators.
  p = p.split(path.sep).join("/");
  // Lowercase the drive letter on Windows ("C:/..." -> "c:/...").
  if (/^[A-Za-z]:\//.test(p)) {
    p = p[0].toLowerCase() + p.slice(1);
  }
  return p;
}

export function writeSourceMap(map: GeneratedSourceMap): string {
  const mapPath = toSourceMapPath(map.generatedFilePath);
  writeText(mapPath, JSON.stringify(map, null, 2) + "\n");
  return mapPath;
}

export function readSourceMap(mapPath: string): GeneratedSourceMap {
  return JSON.parse(readText(mapPath)) as GeneratedSourceMap;
}

export function makeGeneratedMap(
  generatedFilePath: string,
  sourceFilePath: string,
  entries: SourceMapEntry[],
): GeneratedSourceMap {
  return {
    version: 1,
    generatedFilePath,
    sourceFilePath,
    entries,
  };
}

function scoreEntry(entry: SourceMapEntry, line: number, column: number): number {
  if (line < entry.generatedStartLine || line > entry.generatedEndLine) {
    return Number.POSITIVE_INFINITY;
  }

  if (line === entry.generatedStartLine && column < entry.generatedStartColumn) {
    return Number.POSITIVE_INFINITY;
  }

  if (line === entry.generatedEndLine && column > entry.generatedEndColumn) {
    return Number.POSITIVE_INFINITY;
  }

  const lineSpan = Math.max(1, entry.generatedEndLine - entry.generatedStartLine + 1);
  const colSpan = Math.max(1, entry.generatedEndColumn - entry.generatedStartColumn + 1);
  return lineSpan * 100000 + colSpan;
}

function nearestEntry(entries: SourceMapEntry[], line: number): SourceMapEntry | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  return entries
    .slice()
    .sort((a, b) => {
      const da = Math.min(Math.abs(a.generatedStartLine - line), Math.abs(a.generatedEndLine - line));
      const db = Math.min(Math.abs(b.generatedStartLine - line), Math.abs(b.generatedEndLine - line));
      return da - db;
    })[0];
}

export function mapCppLocationToTs(
  map: GeneratedSourceMap,
  cppLine: number,
  cppColumn: number,
  message?: string,
  cppFilePath?: string,
): MappedDiagnostic {
  const scored = map.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, cppLine, cppColumn) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score);

  const best = scored.length > 0 ? scored[0].entry : nearestEntry(map.entries, cppLine);

  return {
    cppFilePath: cppFilePath ?? map.generatedFilePath,
    cppLine,
    cppColumn,
    message,
    mappedTsSpan: best?.tsSpan,
    nodeKind: best?.nodeKind,
    symbolName: best?.symbolName,
  };
}

/**
 * Resolve source map path for a generated program
 * When a program is flattened, the source map needs to account for merged files
 */
export function resolveSourceMapForProgram(
  programPath: string,
  originalSourceMapPath?: string
): string | undefined {
  const programDir = path.dirname(programPath);
  const programName = path.basename(programPath, path.extname(programPath));
  
  // First try the original source map path
  if (originalSourceMapPath && fs.existsSync(originalSourceMapPath)) {
    return originalSourceMapPath;
  }
  
  // Try to find source maps for the program directory
  const possibleMaps = [
    path.join(programDir, `${programName}.thcppmap.json`),
    path.join(programDir, `${programName}.cpp.thcppmap.json`),
    path.join(programDir, "example.thcppmap.json"), // Common case for example programs
  ];
  
  for (const mapPath of possibleMaps) {
    if (fs.existsSync(mapPath)) {
      return mapPath;
    }
  }
  
  // Look for any .thcppmap.json files in the program directory
  try {
    const files = fs.readdirSync(programDir);
    const mapFiles = files.filter(f => f.endsWith('.thcppmap.json'));
    if (mapFiles.length > 0) {
      // Return the most recent one
      const latest = mapFiles.sort().pop();
      return path.join(programDir, latest!);
    }
  } catch {
    // Ignore readdir errors
  }

  return undefined;
}

/**
 * Index of every per-file source map in a build directory, keyed by the
 * normalized generated file path (the .cpp/.h each map covers).
 *
 * Native (g++) mode compiles every .cpp in the output dir, each with its
 * own .thcppmap.json. An error can originate in any of them, so we need to
 * resolve the correct map per error rather than relying on a single entry
 * map.
 */
export type SourceMapIndex = Map<string, GeneratedSourceMap>;

/**
 * Load every `*.thcppmap.json` in `buildDir` (non-recursive) into an index
 * keyed by the normalized `generatedFilePath`. Returns an empty index if the
 * directory is missing or contains no maps.
 */
export function buildSourceMapIndex(buildDir: string): SourceMapIndex {
  const index: SourceMapIndex = new Map();
  let files: string[];
  try {
    files = fs.readdirSync(buildDir);
  } catch {
    return index;
  }

  for (const file of files) {
    if (!file.endsWith(".thcppmap.json")) continue;
    const mapPath = path.join(buildDir, file);
    try {
      const map = JSON.parse(readText(mapPath)) as GeneratedSourceMap;
      if (map && map.generatedFilePath) {
        index.set(normalizeFilePath(map.generatedFilePath), map);
      }
    } catch {
      // Skip unreadable / malformed maps rather than aborting the whole index.
    }
  }

  return index;
}

/**
 * Map a g++/compiler error back to its TypeScript source span.
 *
 * Selects the per-file source map whose `generatedFilePath` matches the
 * error's `filePath`, then delegates to `mapCppLocationToTs`. If the exact
 * generated file isn't keyed (e.g. the compiler reported a differently
 * normalized path, or the error came from a header), falls back to a
 * directory-wide search across every loaded map.
 *
 * Returns a `MappedDiagnostic` whose `mappedTsSpan` is `undefined` when no
 * map could resolve the location (the caller should treat that as a raw
 * C++ fallback).
 */
export function mapCppErrorToTs(
  index: SourceMapIndex,
  error: { filePath: string; line: number; column: number; message?: string },
): MappedDiagnostic {
  const normalized = normalizeFilePath(error.filePath);

  // 1. Direct hit on the generated file's own map.
  const direct = index.get(normalized);
  if (direct) {
    return mapCppLocationToTs(
      direct,
      error.line,
      error.column,
      error.message,
      error.filePath,
    );
  }

  // 2. Header / alternate-path fallback: search every loaded map. This
  //    covers errors reported against a .h (which shares the dir) and any
  //    remaining path-normalization drift between the compiler and emitter.
  let best: MappedDiagnostic | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const map of index.values()) {
    // Find the tightest in-range entry across all maps; mapCppLocationToTs
    // always falls back to a nearest match, so we score ourselves to only
    // accept a genuinely in-range candidate.
    const scored = map.entries
      .map((entry) => ({ entry, score: scoreEntry(entry, error.line, error.column) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => a.score - b.score);
    if (scored.length === 0) continue;
    if (scored[0].score < bestScore) {
      bestScore = scored[0].score;
      best = mapCppLocationToTs(
        map,
        error.line,
        error.column,
        error.message,
        error.filePath,
      );
    }
  }

  if (best) return best;

  // 3. Nothing loaded at all — return unmapped so the caller can show the
  //    raw C++ location.
  return {
    cppFilePath: error.filePath,
    cppLine: error.line,
    cppColumn: error.column,
    message: error.message,
    mappedTsSpan: undefined,
  };
}
