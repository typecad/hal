import path from "node:path";
import { parseCommandLine, printHelp } from "./utils/cli";
import { generateLibraryDefinitions, transpileFile } from "./transpile";
import { mapCppLocationToTs, readSourceMap, resolveMapPath } from "./mapping/source-map";
import { compileArduinoSketch } from "./platform/arduino-compile";
import { generateArduinoTypes } from "./platform/arduino-types";

function assertTypeScriptInput(filePath: string, command: "transpile" | "gen-libdefs" | "gen-types"): void {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== ".ts" && extension !== ".tsx") {
    throw new Error(
      `Invalid input for '${command}': expected a .ts or .tsx file, received '${extension || "<no extension>"}'.`,
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

    if (options.command === "gen-types") {
      const outputPath = path.join(options.outDir ?? process.cwd(), ".build", "arduino.d.ts");
      
      const arduino = options.platformContext?.arduino;
      const result = generateArduinoTypes({
        fqbn: arduino?.fqbn,
        architecture: arduino?.architecture,
        arduinoCliJsonPath: arduino?.arduinoCliJsonPath,
        outputPath,
      });

      printDiagnostics(result.diagnostics);
      console.log(`Generated type declarations: ${result.outputPath}`);
      return;
    }

    if (!options.inputFile) {
      throw new Error("Missing input TypeScript file path.");
    }

    assertTypeScriptInput(options.inputFile, options.command);

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

    const result = transpileFile({
      inputFile: options.inputFile,
      emitMode: options.emitMode,
      target: options.target,
      outDir: options.outDir,
      emitMaps: options.emitMaps,
      compileArduino: options.compileArduino,
      platformContext: options.platformContext,
      treeShaking: options.treeShaking,
    });

    if (options.target === "arduino") {
      const arduino = options.platformContext?.arduino;
      const transpileBaseDir = options.outDir ?? path.dirname(options.inputFile);
      const typeDeclPath = path.join(transpileBaseDir, ".build", "arduino.d.ts");
      const typeResult = generateArduinoTypes({
        fqbn: arduino?.fqbn,
        architecture: arduino?.architecture,
        arduinoCliJsonPath: arduino?.arduinoCliJsonPath,
        outputPath: typeDeclPath,
      });

      printDiagnostics(typeResult.diagnostics);
      console.log(`Generated type declarations: ${typeResult.outputPath}`);
    }

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

    if (options.compileArduino) {
      if (options.target !== "arduino") {
        throw new Error("--compile-arduino requires --target arduino.");
      }

      const fqbn = options.platformContext?.arduino?.fqbn;
      if (!fqbn) {
        throw new Error("--compile-arduino requires --fqbn <package:arch:board>.");
      }

      const compileResult = compileArduinoSketch(result.sourcePath, fqbn);
      printMappedCompileErrors(compileResult, result.sourceMapPath);

      if (!compileResult.success) {
        if (compileResult.output && options.compileArduino !== "strict") {
          console.error(compileResult.output);
        }
        process.exitCode = 1;
        return;
      }

      console.log("Arduino compile succeeded.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(message);
    process.exitCode = 1;
  }
}

main();
