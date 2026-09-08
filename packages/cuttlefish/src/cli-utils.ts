import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import {
  buildSourceMapIndex,
  mapCppErrorToTs,
  mapCppLocationToTs,
  readSourceMap,
  resolveSourceMapForProgram,
  type SourceMapIndex,
} from "./mapping/source-map.js";
import type { CompileResult, Diagnostic } from "./api/shared/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveExpectCliPath(): string {
  // The hardware-test runner lives in this package (src/test-runner/ since
  // the expect package dissolved) — dist/test-runner/cli.js.
  const local = path.resolve(__dirname, "test-runner", "cli.js");
  if (fs.existsSync(local)) return local;
  throw new Error(
    "cuttlefish test-runner CLI not found at " + local + " — the cuttlefish install is incomplete; reinstall @typecad/cuttlefish.",
  );
}

export function runExpectTests(options: { port?: string; buildTarget?: string; baud?: number; expectFile?: string }): number {
  const args: string[] = [];
  if (options.port) args.push("--port", options.port);
  if (options.buildTarget) args.push("--build-target", options.buildTarget);
  if (options.baud) args.push("--baud", String(options.baud));
  if (options.expectFile) args.push(path.resolve(process.cwd(), options.expectFile));
  return runTestRunner(args);
}

/** Spawn the hardware test-runner CLI with forwarded arguments. */
export function runTestRunner(forwardedArgs: string[]): number {
  const result = spawnSync(process.execPath, [resolveExpectCliPath(), ...forwardedArgs], {
    encoding: "utf8",
    cwd: process.cwd(),
    timeout: 0,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

export function assertTypeScriptInput(filePath: string): void {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== ".ts" && extension !== ".tsx" && extension !== ".ui") {
    throw new Error(
      `Expected a .ts, .tsx, or .ui file, received '${extension || "<no extension>"}'.`,
    );
  }
}

export function printDiagnostics(diagnostics: Array<Diagnostic | { severity: string; message: string; hint?: string; line?: number; column?: number; code?: string; filePath?: string; sourceLine?: string }>): void {
  for (const diagnostic of diagnostics) {
    const position = diagnostic.line && diagnostic.column ? chalk.gray(`(${diagnostic.line},${diagnostic.column})`) : "";
    const code = diagnostic.code ? chalk.gray(` [${diagnostic.code}]`) : "";
    const file = 'filePath' in diagnostic && diagnostic.filePath ? chalk.cyan(diagnostic.filePath) : "";

    let severityLabel: string;
    let hintColor: (s: string) => string;
    if (diagnostic.severity === "error") {
      severityLabel = chalk.red.bold("error");
      hintColor = chalk.red;
    } else if (diagnostic.severity === "warning") {
      severityLabel = chalk.yellow.bold("warning");
      hintColor = chalk.yellow;
    } else {
      severityLabel = chalk.cyan.bold(diagnostic.severity);
      hintColor = chalk.cyan;
    }

    const location = position ? ` ${position}` : "";
    const filePrefix = file ? `${file} ` : "";
    const header = `${filePrefix}${severityLabel}${code}${location}: ${chalk.white(diagnostic.message)}`;

    if (diagnostic.severity === "error") {
      console.error(header);
    } else {
      console.warn(header);
    }

    if (diagnostic.sourceLine && diagnostic.column != null) {
      const col = diagnostic.column;
      const prefix = "    ";
      const sourceOutput = prefix + diagnostic.sourceLine;
      if (diagnostic.severity === "error") {
        console.error(sourceOutput);
      } else {
        console.warn(sourceOutput);
      }
      const caret = prefix + " ".repeat(Math.max(0, col - 1)) + "^";
      if (diagnostic.severity === "error") {
        console.error(chalk.gray(caret));
      } else {
        console.warn(chalk.gray(caret));
      }
    }

    if (diagnostic.hint) {
      const hintLines = diagnostic.hint.split("\n");
      for (const hintLine of hintLines) {
        const formatted = hintColor(`  \u21b3  ${hintLine}`);
        if (diagnostic.severity === "error") {
          console.error(formatted);
        } else {
          console.warn(formatted);
        }
      }
    }
  }
}

/**
 * Print compiler (g++/native) errors mapped back to the TypeScript source
 * that generated them.
 *
 * The mapped TypeScript errors are the PRIMARY output — shown in the same
 * rich style as `printDiagnostics` (file:line:col + source line + caret).
 * Errors that cannot be mapped (e.g. generated runtime shims/polyfills with
 * no TS origin) are shown afterwards as a demoted, gray C++ fallback so no
 * information is lost.
 *
 * Resolution strategy:
 *  - If `buildDir` is supplied (native mode), build a per-file source-map
 *    index over every `*.thcppmap.json` in the dir and map each error via
 *    its own translation unit's map.
 *  - Otherwise fall back to the single-map program path so non-native
 *    frameworks keep their existing behavior.
 */
export function printMappedCompileErrors(
  compileResult: CompileResult,
  originalSourceMapPath?: string,
  programPath?: string,
  buildDir?: string,
): { printed: boolean } {
  if (compileResult.errors.length === 0) {
    return { printed: false };
  }

  // Build the source-map index (native: per-file maps; otherwise single map).
  let index: SourceMapIndex | undefined;
  if (buildDir) {
    index = buildSourceMapIndex(buildDir);
    if (index.size === 0) index = undefined;
  }
  let singleMap: ReturnType<typeof readSourceMap> | undefined;
  if (!index) {
    let sourceMapPath = originalSourceMapPath;
    if (programPath && !sourceMapPath) {
      sourceMapPath = resolveSourceMapForProgram(programPath, originalSourceMapPath);
    }
    singleMap = sourceMapPath ? readSourceMap(sourceMapPath) : undefined;
  }

  const mapped: Array<{ error: typeof compileResult.errors[number]; tsFile: string; tsLine: number; tsColumn: number; sourceLine?: string; nodeKind?: string; symbolName?: string }> = [];
  const unmapped: typeof compileResult.errors = [];

  for (const error of compileResult.errors) {
    const mappedDiag = index
      ? mapCppErrorToTs(index, error)
      : singleMap
        ? mapCppLocationToTs(singleMap, error.line, error.column, error.message, error.filePath)
        : undefined;

    const span = mappedDiag?.mappedTsSpan;
    if (span) {
      mapped.push({
        error,
        tsFile: span.filePath,
        tsLine: span.startLine,
        tsColumn: span.startColumn,
        sourceLine: readSourceLine(span.filePath, span.startLine),
        nodeKind: mappedDiag?.nodeKind,
        symbolName: mappedDiag?.symbolName,
      });
    } else {
      unmapped.push(error);
    }
  }

  // Primary: mapped TypeScript errors (rich format, mirrors printDiagnostics).
  for (const item of mapped) {
    printMappedTsError(item.error, item.tsFile, item.tsLine, item.tsColumn, item.sourceLine, item.nodeKind, item.symbolName);
  }

  // Demoted fallback: raw C++ errors with no TS origin.
  if (unmapped.length > 0) {
    if (mapped.length > 0) {
      console.error("");
    }
    console.error(chalk.gray(`Unmapped (generated-code) ${unmapped.length === 1 ? "error" : "errors"}:`));
    for (const error of unmapped) {
      const rel = relativeForDisplay(error.filePath);
      const line = chalk.gray(`  \u21b3 (generated C++) ${rel}(${error.line},${error.column}): ${error.severity}: ${error.message}`);
      if (error.severity === "error") {
        console.error(line);
      } else {
        console.warn(line);
      }
    }
  }

  return { printed: mapped.length > 0 || unmapped.length > 0 };
}

/** Read a single 1-based source line for caret display; returns undefined on failure. */
function readSourceLine(filePath: string, line: number): string | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.split(/\r?\n/)[line - 1];
  } catch {
    return undefined;
  }
}

/** Make a path relative to cwd for display, falling back to the original. */
function relativeForDisplay(filePath: string): string {
  try {
    const rel = path.relative(process.cwd(), filePath);
    return rel && !rel.startsWith("..") ? rel : filePath;
  } catch {
    return filePath;
  }
}

/** Print one mapped error in the rich printDiagnostics style. */
function printMappedTsError(
  error: { severity: string; message: string },
  tsFile: string,
  tsLine: number,
  tsColumn: number,
  sourceLine?: string,
  nodeKind?: string,
  symbolName?: string,
): void {
  const rel = relativeForDisplay(tsFile);
  const position = chalk.gray(`(${tsLine},${tsColumn})`);

  let severityLabel: string;
  if (error.severity === "error") {
    severityLabel = chalk.red.bold("error");
  } else if (error.severity === "warning") {
    severityLabel = chalk.yellow.bold("warning");
  } else {
    severityLabel = chalk.cyan.bold(String(error.severity));
  }

  const origin = symbolName ? chalk.gray(` [${nodeKind ?? "generated"}: ${symbolName}]`) : nodeKind ? chalk.gray(` [${nodeKind}]`) : "";
  const header = `${chalk.cyan(rel)} ${position} ${severityLabel}${origin}: ${chalk.white(error.message)}`;

  if (error.severity === "error") {
    console.error(header);
  } else {
    console.warn(header);
  }

  if (sourceLine) {
    const prefix = "    ";
    const col = tsColumn;
    const sourceOutput = prefix + sourceLine;
    if (error.severity === "error") {
      console.error(sourceOutput);
    } else {
      console.warn(sourceOutput);
    }
    const caret = prefix + " ".repeat(Math.max(0, col - 1)) + "^";
    if (error.severity === "error") {
      console.error(chalk.gray(caret));
    } else {
      console.warn(chalk.gray(caret));
    }
  }
}
