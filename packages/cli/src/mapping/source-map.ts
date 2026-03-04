import path from "node:path";
import fs from "node:fs";
import { GeneratedSourceMap, MappedDiagnostic, SourceMapEntry } from "../types";
import { readText, writeText } from "../utils/fs";

export function toSourceMapPath(generatedFilePath: string): string {
  return `${generatedFilePath}.tscppmap.json`;
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

export function resolveMapPath(mapFileOrGeneratedFile: string): string {
  if (mapFileOrGeneratedFile.endsWith(".tscppmap.json")) {
    return path.resolve(process.cwd(), mapFileOrGeneratedFile);
  }

  return toSourceMapPath(path.resolve(process.cwd(), mapFileOrGeneratedFile));
}

/**
 * Resolve source map path for a flattened Arduino sketch
 * When a sketch is flattened, the source map needs to account for merged files
 */
export function resolveSourceMapForSketch(
  sketchPath: string,
  originalSourceMapPath?: string
): string | undefined {
  const sketchDir = path.dirname(sketchPath);
  const sketchName = path.basename(sketchPath, path.extname(sketchPath));
  
  // First try the original source map path
  if (originalSourceMapPath && fs.existsSync(originalSourceMapPath)) {
    return originalSourceMapPath;
  }
  
  // Try to find source maps for the sketch directory
  const possibleMaps = [
    path.join(sketchDir, `${sketchName}.tscppmap.json`),
    path.join(sketchDir, `${sketchName}.ino.tscppmap.json`),
    path.join(sketchDir, "example.tscppmap.json"), // Common case for example sketches
  ];
  
  for (const mapPath of possibleMaps) {
    if (fs.existsSync(mapPath)) {
      return mapPath;
    }
  }
  
  // Look for any .tscppmap.json files in the sketch directory
  try {
    const files = fs.readdirSync(sketchDir);
    const mapFiles = files.filter(f => f.endsWith('.tscppmap.json'));
    if (mapFiles.length > 0) {
      // Return the most recent one
      const latest = mapFiles.sort().pop();
      return path.join(sketchDir, latest!);
    }
  } catch {
    // Ignore readdir errors
  }
  
  return undefined;
}
