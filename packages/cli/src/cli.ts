#!/usr/bin/env node
import path from "node:path";
import { parseCommandLine, printHelp } from "./utils/cli";
import { generateLibraryDefinitions, transpileFile } from "./transpile";
import { mapCppLocationToTs, readSourceMap, resolveMapPath } from "./mapping/source-map";
import { compileArduinoSketch, uploadArduinoSketch, monitorArduinoSketch } from "./platform/arduino-compile";
import { loadTypecodeConfig, generateVirtualTypeDeclaration } from "./config-loader";

function assertTypeScriptInput(filePath: string): void {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== ".ts" && extension !== ".tsx") {
    throw new Error(
      `Expected a .ts or .tsx file, received '${extension || "<no extension>"}'.`,
    );
  }
}

function printDiagnostics(diagnostics: Array<{ severity: string; message: string; line?: number; column?: number; code?: string }>): void {
  for (const diagnostic of diagnostics) {
    const position = diagnostic.line && diagnostic.column ? `(${diagnostic.line},${diagnostic.column})` : "";
    const code = diagnostic.code ? `[${diagnostic.code}]` : "";
    const prefix = `${diagnostic.severity.toUpperCase()} ${code}${position}`.trim();
    const line = `${prefix}: ${diagnostic.message}`;
    if (diagnostic.severity === "error") {
      console.error(line);
    } else {
      console.warn(line);
    }
  }
}

function printMappedCompileErrors(
  compileResult: ReturnType<typeof compileArduinoSketch>,
  sourceMapPath?: string,
): void {
  if (compileResult.errors.length === 0) {
    return;
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
    } else {
      console.warn(fallback);
    }
  }
}

function main(): void {
  try {
    const options = parseCommandLine(process.argv);

    if (options === "help") {
      printHelp();
      return;
    }

    if (options.command === "map-error") {
      if (!options.mapFile || !options.cppLine || !options.cppColumn) {
        throw new Error("map-error requires map file and C++ line/column options.");
      }

      const mapPath = resolveMapPath(options.mapFile);
      const sourceMap = readSourceMap(mapPath);
      const mapped = mapCppLocationToTs(
        sourceMap,
        options.cppLine,
        options.cppColumn,
        options.message,
        options.cppFile,
      );

      if (!mapped.mappedTsSpan) {
        console.log("No TypeScript mapping found for the provided C++ location.");
      } else {
        console.log(
          [
            `Mapped TS location: ${mapped.mappedTsSpan.filePath}`,
            `(${mapped.mappedTsSpan.startLine},${mapped.mappedTsSpan.startColumn})`,
            `node=${mapped.nodeKind ?? "unknown"}`,
            mapped.symbolName ? `symbol=${mapped.symbolName}` : undefined,
          ]
            .filter(Boolean)
            .join(" "),
        );
      }

      if (mapped.message) {
        console.log(`Compiler message: ${mapped.message}`);
      }
      return;
    }

    if (!options.inputFile) {
      throw new Error("Missing input TypeScript file path.");
    }

    assertTypeScriptInput(options.inputFile);

    if (options.command === "gen-libdefs") {
      const outDir = path.dirname(options.inputFile);
      const created = generateLibraryDefinitions({
        inputFile: options.inputFile,
        outDir,
      });

      if (created.length === 0) {
        console.log("No new library definition files created.");
      } else {
        console.log("Created library definition files:");
        for (const filePath of created) {
          console.log(`- ${filePath}`);
        }
      }
      return;
    }

    // Default: transpile (always first)

    // ── Load typecode.config.ts (config wins over CLI flags) ──────────
    const inputDir = path.dirname(path.resolve(options.inputFile));
    const config = loadTypecodeConfig(inputDir);

    let effectivePlatformContext = options.platformContext;
    let effectiveTarget = options.target;
    let effectiveOutDir = options.outDir;
    let effectiveBoardPackage = options.boardPackage;

    if (config) {
      // Keep typecode-env.d.ts in sync so the TS language server can resolve
      // bare '@typecode' imports in editor without a linter error.
      generateVirtualTypeDeclaration(config);

      // Config is the source of truth — override CLI-provided values.
      if (config.fqbn) {
        effectivePlatformContext = {
          arduino: { fqbn: config.fqbn },
        };
      }
      if (config.target) {
        // Map config target (architecture id like 'avr') to the transpiler's
        // TargetProfile.  Presence of an fqbn implies arduino target.
        if (config.fqbn || config.outputFramework === "arduino") {
          effectiveTarget = "arduino";
        }
      }
      if (config.outputOutDir && !options.outDir) {
        effectiveOutDir = path.resolve(inputDir, config.outputOutDir);
      }
      if (config.board) {
        effectiveBoardPackage = config.board;
      }
    }

    const result = transpileFile({
      inputFile: options.inputFile,
      emitMode: options.emitMode,
      target: effectiveTarget,
      outDir: effectiveOutDir,
      emitMaps: options.emitMaps,
      platformContext: effectivePlatformContext,
      treeShaking: options.treeShaking,
      boardPackage: effectiveBoardPackage,
      debug: options.debug,
    });

    printDiagnostics(result.diagnostics);
    if (result.headerPath) {
      console.log(`Generated header: ${result.headerPath}`);
    }
    console.log(`Generated source: ${result.sourcePath}`);
    if (result.headerMapPath) {
      console.log(`Generated header map: ${result.headerMapPath}`);
    }
    if (result.sourceMapPath) {
      console.log(`Generated source map: ${result.sourceMapPath}`);
    }

    if (!options.compile) {
      return;
    }

    // --compile
    const fqbn = effectivePlatformContext?.arduino?.fqbn ?? options.platformContext?.arduino?.fqbn;
    if (!fqbn) {
      throw new Error("--compile requires --fqbn <package:arch:board> or a typecode.config.ts with fqbn.");
    }

    console.log(`Compiling for ${fqbn}...`);
    const compileResult = compileArduinoSketch(result.sourcePath, fqbn);
    printMappedCompileErrors(compileResult, result.sourceMapPath);

    if (!compileResult.success) {
      console.error(compileResult.output);
      process.exitCode = 1;
      return;
    }

    console.log("Compile succeeded.");

    if (!options.upload) {
      return;
    }

    // --upload
    const port = options.port!;
    console.log(`Uploading to ${port}...`);

    const sketchDir = path.dirname(result.sourcePath);
    const uploadResult = uploadArduinoSketch(sketchDir, fqbn, port);

    if (uploadResult.output) {
      console.log(uploadResult.output);
    }

    if (!uploadResult.success) {
      process.exitCode = 1;
      return;
    }

    console.log("Upload succeeded.");

    if (!options.monitor) {
      return;
    }

    // --monitor (blocks until Ctrl+C)
    console.log(`Opening serial monitor on ${port} at ${options.baud} baud. Press Ctrl+C to exit.`);
    monitorArduinoSketch(port, options.baud);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(message);
    process.exitCode = 1;
  }
}

main();