#!/usr/bin/env node
import path from "node:path";
import { parseCommandLine, printHelp } from "./utils/cli";
import { generateLibraryDefinitions, transpileFile } from "./transpile";
import { generateDeclFromCpp, generateDeclsForDirectory } from "./libdef/cpp-to-decl";
import { mapCppLocationToTs, readSourceMap, resolveMapPath, resolveSourceMapForSketch } from "./mapping/source-map";
import { compileArduinoSketch, uploadArduinoSketch, monitorArduinoSketch } from "./platform/arduino-compile";
import { loadTypecodeConfig, generateVirtualTypeDeclaration, validateBoardPackage } from "./config-loader";
import { scaffoldBoardPackage, scaffoldFromWizard, printNextSteps } from "./scaffold/board-scaffold";
import { runBoardWizard } from "./scaffold/wizard";
import * as ui from "./utils/ui";

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
  originalSourceMapPath?: string,
  sketchPath?: string,
): void {
  if (compileResult.errors.length === 0) {
    return;
  }

  // Try to find the appropriate source map for the sketch
  let sourceMapPath = originalSourceMapPath;
  
  if (sketchPath && !sourceMapPath) {
    // For flattened sketches, try to find the source map in the sketch directory
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

    // If mapping failed, provide helpful information about the error
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

async function main(): Promise<void> {
  try {
    const options = parseCommandLine(process.argv);

    if (options === "help") {
      printHelp();
      return;
    }

    // Handle create-board command
    if (options.command === "create-board") {
      const scaffoldOptions = options as import("./types").ScaffoldCommandOptions;
      
      try {
        // Check if we should run the interactive wizard
        // Run wizard if: no additional options provided, or explicitly requested
        const hasOptions = scaffoldOptions.architecture || scaffoldOptions.vendor || 
          scaffoldOptions.mcu || scaffoldOptions.displayName;
        
        if (!hasOptions) {
          // Launch interactive wizard
          console.log("Launching interactive board creation wizard...\n");
          const wizardResult = await runBoardWizard();
          
          if (!wizardResult) {
            console.log("Board creation cancelled.");
            return;
          }
          
          // Scaffold from wizard results with full pin data
          const createdFiles = scaffoldFromWizard(wizardResult, scaffoldOptions.outDir);
          
          console.log("\nCreated board package files:");
          for (const file of createdFiles) {
            console.log(`  ${file}`);
          }
          
          const outDir = scaffoldOptions.outDir 
            ? scaffoldOptions.outDir 
            : path.resolve(process.cwd(), 'packages', `board-${wizardResult.name}`);
          
          printNextSteps(wizardResult.name, outDir);
        } else {
          // Non-interactive mode: use CLI flags
          const createdFiles = scaffoldBoardPackage({
            name: scaffoldOptions.name,
            displayName: scaffoldOptions.displayName,
            vendor: scaffoldOptions.vendor,
            architecture: scaffoldOptions.architecture,
            mcu: scaffoldOptions.mcu,
            clockSpeedMhz: scaffoldOptions.clockSpeedMhz,
            flashKb: scaffoldOptions.flashKb,
            sramKb: scaffoldOptions.sramKb,
            eepromKb: scaffoldOptions.eepromKb,
            fqbn: scaffoldOptions.fqbn,
            outDir: scaffoldOptions.outDir,
            minimal: scaffoldOptions.minimal,
          });

          console.log("Created board package files:");
          for (const file of createdFiles) {
            console.log(`  ${file}`);
          }

          // Determine output directory for next steps
          const outDir = scaffoldOptions.outDir 
            ? scaffoldOptions.outDir 
            : path.resolve(process.cwd(), 'packages', `board-${scaffoldOptions.name}`);
          
          printNextSteps(scaffoldOptions.name, outDir);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`Error creating board package: ${message}`);
        process.exitCode = 1;
      }
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
      throw new Error("Missing input file path.");
    }

    if (options.command === "gen-decls") {
      // Check for --all flag (scan directory)
      const scanDir = (options as any).scanDir as string | undefined;
      
      if (scanDir) {
        ui.printHeader();
        ui.printStep(`Scanning ${scanDir} for C++ files...`);
        const created = generateDeclsForDirectory(scanDir, true);
        
        if (created.length === 0) {
          ui.printInfo("No new declaration files created.");
        } else {
          ui.printSuccess("Created declaration files:");
          for (const filePath of created) {
            ui.printFileCreated(filePath);
          }
        }
        return;
      }
      
      // Single file mode - C++ input expected
      const extension = path.extname(options.inputFile).toLowerCase();
      if (extension !== ".cpp") {
        throw new Error(`gen-decls expects a .cpp file, received '${extension || "<no extension>"}'.`);
      }
      
      ui.printHeader();
      ui.printStep("Generating declarations...");
      const created = generateDeclFromCpp(options.inputFile);
      if (created) {
        ui.printSuccess(`Created: ${created}`);
      } else {
        ui.printInfo("No declaration file created (no classes or constants found).");
      }
      return;
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

    // ── Load typecode.config.ts (config wins over CLI flags) ──────────
    const inputDir = path.dirname(path.resolve(options.inputFile));
    const config = loadTypecodeConfig(inputDir);

    let effectivePlatformContext = options.platformContext;
    let effectiveTarget = options.target;
    let effectiveOutDir = options.outDir;
    let effectiveBoardPackage = options.boardPackage;
    let effectiveFrameworkPackage = options.frameworkPackage;

    if (config) {
      // Validate board package exists before proceeding
      if (config.board) {
        const validationError = validateBoardPackage(config.board, config.configPath);
        if (validationError) {
          ui.printError(validationError);
          process.exitCode = 1;
          return;
        }
      }

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
      // Load framework package from config (new approach)
      if (config.framework) {
        effectiveFrameworkPackage = config.framework;
      }
      // Pass console baud rate to platform context
      if (config.console?.baudRate) {
        effectivePlatformContext = effectivePlatformContext || {};
        (effectivePlatformContext as any).console = { baudRate: config.console.baudRate };
      }
    }

    // Print branded header and build info
    ui.printHeader();
    ui.printBuildInfo({
      framework: effectiveFrameworkPackage,
      board: effectiveBoardPackage,
      fqbn: effectivePlatformContext?.arduino?.fqbn,
    });

    let result: { headerPath?: string; sourcePath: string; headerMapPath?: string; sourceMapPath?: string; diagnostics: Array<{ severity: string; message: string; line?: number; column?: number; code?: string }> };

    if (options.noTranspile) {
      // Skip transpilation - use existing generated files
      const inputBasename = path.basename(options.inputFile, path.extname(options.inputFile));
      const outDirPath = effectiveOutDir || inputDir;
      result = {
        sourcePath: path.join(outDirPath, `${inputBasename}.cpp`),
        headerPath: effectiveTarget === "arduino" ? undefined : path.join(outDirPath, `${inputBasename}.h`),
        sourceMapPath: path.join(outDirPath, `${inputBasename}.cpp.map`),
        headerMapPath: effectiveTarget === "arduino" ? undefined : path.join(outDirPath, `${inputBasename}.h.map`),
        diagnostics: [],
      };
    } else {
      // Default: transpile first
      ui.printTranspiling();
      result = transpileFile({
        inputFile: options.inputFile,
        emitMode: options.emitMode,
        target: effectiveTarget,
        outDir: effectiveOutDir,
        emitMaps: options.emitMaps,
        platformContext: effectivePlatformContext,
        treeShaking: options.treeShaking,
        boardPackage: effectiveBoardPackage,
        frameworkPackage: effectiveFrameworkPackage,
        debug: options.debug,
      });

      printDiagnostics(result.diagnostics);
    }

    if (!options.compile) {
      ui.printSuccess();
      return;
    }

    // --compile
    const fqbn = effectivePlatformContext?.arduino?.fqbn ?? options.platformContext?.arduino?.fqbn;
    if (!fqbn) {
      throw new Error("--compile requires --fqbn <package:arch:board> or a typecode.config.ts with fqbn.");
    }

    ui.printCompiling(fqbn);
    const compileResult = compileArduinoSketch(result.sourcePath, fqbn);
    printMappedCompileErrors(compileResult, result.sourceMapPath, result.sourcePath);

    if (!compileResult.success) {
      console.error(compileResult.output);
      process.exitCode = 1;
      return;
    }

    if (!options.upload) {
      ui.printSuccess();
      return;
    }

    // --upload
    const port = options.port!;
    ui.printUploading(port);

    const sketchDir = path.dirname(result.sourcePath);
    const uploadResult = uploadArduinoSketch(sketchDir, fqbn, port);

    if (uploadResult.output) {
      console.log(uploadResult.output);
    }

    if (!uploadResult.success) {
      process.exitCode = 1;
      return;
    }

    if (!options.monitor) {
      ui.printSuccess();
      return;
    }

    // --monitor (blocks until Ctrl+C)
    ui.printMonitoring(port, options.baud);
    monitorArduinoSketch(port, options.baud);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    ui.printError(message);
    process.exitCode = 1;
  }
}

main();