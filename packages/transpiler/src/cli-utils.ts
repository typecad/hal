import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { mapCppLocationToTs, readSourceMap, resolveSourceMapForSketch } from "./mapping/source-map";
import type { CompileResult, Diagnostic } from "@typehal/core/shared";

function resolveExpectCliPath(): string {
  try {
    return require.resolve("@typehal/expect/dist/host/cli.js");
  } catch {
    const monorepoPath = path.resolve(__dirname, "..", "..", "expect", "dist", "host", "cli.js");
    if (fs.existsSync(monorepoPath)) return monorepoPath;

    const nmPath = path.resolve(__dirname, "..", "node_modules", "@typehal", "expect", "dist", "host", "cli.js");
    if (fs.existsSync(nmPath)) return nmPath;

    return "typehal-test";
  }
}

export function runExpectTests(options: { port?: string; fqbn?: string; baud?: number; expectFile?: string }): number {
  const expectCliPath = resolveExpectCliPath();
  const args: string[] = [expectCliPath];
  if (options.port) args.push("--port", options.port);
  if (options.fqbn) args.push("--fqbn", options.fqbn);
  if (options.baud) args.push("--baud", String(options.baud));
  if (options.expectFile) args.push(path.resolve(process.cwd(), options.expectFile));

  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    cwd: process.cwd(),
    timeout: 0,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

export function assertTypeScriptInput(filePath: string): void {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== ".ts" && extension !== ".tsx") {
    throw new Error(
      `Expected a .ts or .tsx file, received '${extension || "<no extension>"}'.`,
    );
  }
}

export function printDiagnostics(diagnostics: Array<Diagnostic | { severity: string; message: string; hint?: string; line?: number; column?: number; code?: string }>): void {
  for (const diagnostic of diagnostics) {
    const position = diagnostic.line && diagnostic.column ? chalk.gray(`(${diagnostic.line},${diagnostic.column})`) : "";
    const code = diagnostic.code ? chalk.gray(` [${diagnostic.code}]`) : "";

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
    const header = `${severityLabel}${code}${location}: ${chalk.white(diagnostic.message)}`;

    if (diagnostic.severity === "error") {
      console.error(header);
    } else {
      console.warn(header);
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

export function printMappedCompileErrors(
  compileResult: CompileResult,
  originalSourceMapPath?: string,
  sketchPath?: string,
): void {
  if (compileResult.errors.length === 0) {
    return;
  }

  let sourceMapPath = originalSourceMapPath;
  if (sketchPath && !sourceMapPath) {
    sourceMapPath = resolveSourceMapForSketch(sketchPath, originalSourceMapPath);
  }

  const sourceMap = sourceMapPath ? readSourceMap(sourceMapPath) : undefined;

  for (const error of compileResult.errors) {
    if (sourceMap) {
      const mapped = mapCppLocationToTs(
        sourceMap,
        error.line,
        error.column,
        error.message,
        error.filePath,
      );

      if (mapped.mappedTsSpan) {
        const formatted = `${mapped.mappedTsSpan.filePath}(${mapped.mappedTsSpan.startLine},${mapped.mappedTsSpan.startColumn}): ${error.severity}: ${error.message}`;
        if (error.severity === "error") {
          console.error(formatted);
        } else {
          console.warn(formatted);
        }
        continue;
      }
    }

    const fallback = `${error.filePath}(${error.line},${error.column}): ${error.severity}: ${error.message}`;
    if (error.severity === "error") {
      console.error(fallback);
      if (sourceMapPath) {
        console.error(`Note: Failed to map C++ error to TypeScript source. Source map: ${sourceMapPath}`);
      }
    } else {
      console.warn(fallback);
    }
  }
}
