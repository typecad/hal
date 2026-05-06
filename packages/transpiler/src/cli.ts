#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { parseCommandLine, printHelp } from "./utils/cli";
import { generateLibraryDefinitions, transpileFile } from "./transpile";
import { generateDeclFromCpp, generateDeclsForDirectory } from "./libdef/cpp-to-decl";
import { mapCppLocationToTs, readSourceMap, resolveMapPath, resolveSourceMapForSketch } from "./mapping/source-map";
import { compileSource, uploadFirmware, monitorDevice } from "./platform/toolchain";
import { resolveStrategy } from "./platform/registry";
import { loadFrameworkPackage } from "./framework-package";
import { getLoadedFramework, hasLoadedFramework } from "./framework-registry";
import { loadTypehalConfig, generateVirtualTypeDeclaration, validateBoardPackage } from "./config-loader";
import { scaffoldBoardPackage, scaffoldFromWizard, printNextSteps } from "./scaffold/board-scaffold";
import { runBoardWizard } from "./scaffold/wizard";
import { runWatch, discoverWatchDirs } from "./watch";
import { runExpectTests, assertTypeScriptInput, printDiagnostics, printMappedCompileErrors } from "./cli-utils";
import * as ui from "./utils/ui";
import chalk from "chalk";
import { resolveBoardBuildTarget } from "./ir/board-resolver";

async function main(): Promise<void> {
  try {
    const options = parseCommandLine(process.argv);

    if (options === "help") {
      printHelp();
      return;
    }

    // Handle init command — delegate to @typehal/create if available
    if (options.command === "init") {
      const initOptions = options as import("./types").InitCommandOptions;

      try {
        // Build the argument list for @typehal/create
        const createArgs: string[] = ["node", "create"];
        if (initOptions.projectName) createArgs.push(initOptions.projectName);
        if (initOptions.board) { createArgs.push("--board", initOptions.board); }
        if (initOptions.framework) { createArgs.push("--framework", initOptions.framework); }
        if (initOptions.baud) { createArgs.push("--baud", String(initOptions.baud)); }
        if (initOptions.noSketch) { createArgs.push("--no-sketch"); }
        if (initOptions.outDir) { createArgs.push("--outDir", initOptions.outDir); }

        try {
          const create = await import("@typehal/create");
          await create.runCreate(createArgs);
        } catch (importError: any) {
          if (importError.code === 'MODULE_NOT_FOUND') {
            throw new Error(
              "The '@typehal/create' package is required for 'typehal init'.\n" +
              "Install it with: npm install -g @typehal/create\n" +
              "Or use: npx @typehal/create",
            );
          }
          throw importError;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`Error creating project: ${message}`);
        process.exitCode = 1;
      }
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
            buildTarget: scaffoldOptions.buildTarget,
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

    // ── Handle build command — entry point comes from config ──────────
    if (options.command === "build") {
      const buildConfig = loadTypehalConfig(process.cwd());
      if (!buildConfig) {
        throw new Error(
          "No typehal.config.ts found in current directory.\n" +
          "Run 'typehal init' to create one, or use: typehal <input.ts> [options]",
        );
      }
      if (!buildConfig.entry) {
        throw new Error(
          "typehal.config.ts has no 'entry' field.\n" +
          "Add: entry: './src/sketch.ts'",
        );
      }

      const entryFile = path.resolve(path.dirname(buildConfig.configPath), buildConfig.entry);
      if (!fs.existsSync(entryFile)) {
        throw new Error(`Entry file not found: ${entryFile}`);
      }

      assertTypeScriptInput(entryFile);
      (options as any).inputFile = entryFile;
    }

    if (!options.inputFile) {
      if (options.expect) {
        const config = loadTypehalConfig(process.cwd());
        const exitCode = runExpectTests({
          port: options.port,
          buildTarget: config?.buildTarget,
          baud: config?.console?.baudRate ?? options.baud,
          expectFile: options.expectFile,
        });
        process.exitCode = exitCode;
        return;
      }
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

    // ── Load typehal.config.ts (config wins over CLI flags) ──────────
    const inputDir = path.dirname(path.resolve(options.inputFile));
    const config = loadTypehalConfig(inputDir);

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

      // Config is the source of truth — override CLI-provided values.
      let configBuildTarget = config.buildTarget;
      
      // If buildTarget is missing from config, try to resolve it from the board manifest
      if (!configBuildTarget && config.board) {
        const framework = config.outputFramework ?? 'arduino';
        configBuildTarget = resolveBoardBuildTarget(config.board, config.configPath, framework);
      }

      if (configBuildTarget) {
        effectivePlatformContext = {
          architecture: configBuildTarget.split(":")?.[1]?.toLowerCase(),
          frameworkData: { buildTarget: configBuildTarget },
        };
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
      if (config.target) {
        // Load framework package and derive the effective target from its strategy id.
        if (effectiveFrameworkPackage) {
          try {
            loadFrameworkPackage(effectiveFrameworkPackage, inputDir);
            if (hasLoadedFramework()) {
              effectiveTarget = getLoadedFramework().strategy.id;
            }
          } catch {
            // Framework not loadable — keep the CLI-provided target
          }
        }
      }
      // Pass console baud rate to platform context
      if (config.console?.baudRate) {
        effectivePlatformContext = effectivePlatformContext || {};
        (effectivePlatformContext as any).console = { baudRate: config.console.baudRate };
      }

      // Keep typehal-env.d.ts in sync so the TS language server can resolve
      // bare '@typehal' imports in editor without a linter error.
      // Platform-specific declarations come from the strategy if available.
      let platformDeclarations: string[] | undefined;
      try {
        // Use the loaded framework's strategy for platform-specific declarations
        const strategy = hasLoadedFramework()
          ? getLoadedFramework().strategy
          : resolveStrategy(effectiveTarget);
        platformDeclarations = strategy.ambientTypeDeclarations?.();
      } catch {
        // Strategy not yet loaded — env.d.ts will have generic declarations only
      }
      generateVirtualTypeDeclaration(config, platformDeclarations);
    }

    // Print branded header and build info
    ui.printHeader();
    ui.printBuildInfo({
      framework: effectiveFrameworkPackage,
      board: effectiveBoardPackage,
      buildTarget: (effectivePlatformContext?.frameworkData?.buildTarget as string | undefined),
    });

    // ── Watch mode ────────────────────────────────────────────────────────
    // In watch mode, the initial build may fail — we catch errors and still
    // start the watcher so the user can fix issues and see it auto-rebuild.
    if (options.watch) {
      let initialBuildOk = false;

      try {
        ui.printTranspiling();
        const result = await transpileFile({
          inputFile: options.inputFile!,
          emitMode: options.emitMode,
          target: effectiveTarget,
          outDir: effectiveOutDir,
          emitMaps: options.emitMaps,
          platformContext: effectivePlatformContext,
          treeShaking: options.treeShaking,
          boardPackage: effectiveBoardPackage,
          frameworkPackage: effectiveFrameworkPackage,
          debug: options.debug,
          force: options.force,
          skipTypeCheck: options.skipTypeCheck,
        });

        printDiagnostics(result.diagnostics);
        ui.printTasks(result.asyncTaskNames ?? [], result.usesTimers ?? false);

        if (result.diagnostics.length === 0) {
          ui.printSuccess();
          initialBuildOk = true;

          // Initial compile + upload if flags are set
          if (options.compile) {
            const buildTarget = (effectivePlatformContext?.frameworkData?.buildTarget as string | undefined) ?? (options.platformContext?.frameworkData?.buildTarget as string | undefined);
            const watchOpts = {
              outputDir: path.dirname(result.sourcePath),
              sourcePath: result.sourcePath,
              buildTarget,
              port: options.port,
              baud: options.baud ?? config?.console?.baudRate,
              optimize: config?.outputOptimize,
              extraFlags: config?.outputExtraFlags,
              defines: config?.outputDefines,
              frameworkConfig: config?.frameworkConfig,
            };
            ui.printCompiling(buildTarget ?? "native");
            const compileResult = compileSource(watchOpts);
            printMappedCompileErrors(compileResult, result.sourceMapPath, result.sourcePath);

            if (compileResult.success) {
              if (compileResult.memoryUsage) ui.printMemoryUsage(compileResult.memoryUsage);
              
              if (options.upload && options.port) {
                ui.printUploading(options.port);
                const uploadResult = uploadFirmware(watchOpts);
                if (uploadResult.output) console.log(uploadResult.output);
                if (uploadResult.success) ui.printSuccess();
              } else {
                ui.printSuccess();
              }
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        ui.printError(message);
        console.log();
        ui.printInfo("Initial build failed — fix errors and save to retry.");
      }

      // Discover directories to watch
      const configPath = config?.configPath;
      const watchDirs = discoverWatchDirs(options.inputFile!, configPath);

      console.log();
      ui.printInfo(`Watching for changes... (${watchDirs.length} dir${watchDirs.length !== 1 ? "s" : ""}, Ctrl+C to stop)`);

      await runWatch({
        watchDirs,
        configPath,
        entryDir: inputDir,
        onRebuild: async (changedFile: string) => {
          // Clear terminal
          process.stdout.write("\x1Bc");

          const timestamp = new Date().toLocaleTimeString();
          const relativePath = path.relative(process.cwd(), changedFile);
          console.log(chalk.cyan(`⤳ typeHAL`) + chalk.gray(` v0.1.0`));
          console.log();
          ui.printInfo(`[${timestamp}] Change detected: ${relativePath}`);
          console.log();

          try {
            ui.printTranspiling();
            const rebuildResult = await transpileFile({
              inputFile: options.inputFile!,
              emitMode: options.emitMode,
              target: effectiveTarget,
              outDir: effectiveOutDir,
              emitMaps: options.emitMaps,
              platformContext: effectivePlatformContext,
              treeShaking: options.treeShaking,
              boardPackage: effectiveBoardPackage,
              frameworkPackage: effectiveFrameworkPackage,
              debug: options.debug,
              force: true, // Always force in watch mode to bypass stale cache
              skipTypeCheck: options.skipTypeCheck,
            });

            printDiagnostics(rebuildResult.diagnostics);
            ui.printTasks(rebuildResult.asyncTaskNames ?? [], rebuildResult.usesTimers ?? false);

            if (rebuildResult.diagnostics.length > 0) {
              // Errors shown via printDiagnostics — skip compile/upload
            } else {
              ui.printSuccess();

              if (options.compile) {
                const buildTarget = (effectivePlatformContext?.frameworkData?.buildTarget as string | undefined) ?? (options.platformContext?.frameworkData?.buildTarget as string | undefined);
                const rebuildOpts = {
                  outputDir: path.dirname(rebuildResult.sourcePath),
                  sourcePath: rebuildResult.sourcePath,
                  buildTarget,
                  port: options.port,
                  baud: options.baud ?? config?.console?.baudRate,
                  optimize: config?.outputOptimize,
                  extraFlags: config?.outputExtraFlags,
                  defines: config?.outputDefines,
                  frameworkConfig: config?.frameworkConfig,
                };
                ui.printCompiling(buildTarget ?? "native");
                const compileResult = compileSource(rebuildOpts);
                printMappedCompileErrors(compileResult, rebuildResult.sourceMapPath, rebuildResult.sourcePath);

                if (compileResult.success) {
                  if (compileResult.memoryUsage) ui.printMemoryUsage(compileResult.memoryUsage);

                  if (options.upload && options.port) {
                    ui.printUploading(options.port);
                    const uploadResult = uploadFirmware(rebuildOpts);
                    if (uploadResult.output) console.log(uploadResult.output);
                    if (uploadResult.success) ui.printSuccess();
                  } else {
                    ui.printSuccess();
                  }
                }
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            ui.printError(message);
          }

          console.log();
          ui.printInfo("Watching for changes... (Ctrl+C to stop)");
        },
      });

      return; // runWatch never resolves under normal operation
    }

    // ── One-shot mode (no --watch) ────────────────────────────────────────
    let result: { headerPath?: string; sourcePath: string; headerMapPath?: string; sourceMapPath?: string; diagnostics: Array<{ severity: string; message: string; line?: number; column?: number; code?: string }> };

    if (options.noTranspile) {
      const inputBasename = path.basename(options.inputFile!, path.extname(options.inputFile!));
      const outDirPath = effectiveOutDir || inputDir;
      const noTranspileStrategy = resolveStrategy(effectiveTarget);
      result = {
        sourcePath: path.join(outDirPath, `${inputBasename}.cpp`),
        headerPath: noTranspileStrategy.generateHeaderFile() ? path.join(outDirPath, `${inputBasename}.h`) : undefined,
        sourceMapPath: path.join(outDirPath, `${inputBasename}.cpp.map`),
        headerMapPath: noTranspileStrategy.generateHeaderFile() ? path.join(outDirPath, `${inputBasename}.h.map`) : undefined,
        diagnostics: [],
      };
    } else {
      ui.printTranspiling();
      result = await transpileFile({
        inputFile: options.inputFile!,
        emitMode: options.emitMode,
        target: effectiveTarget,
        outDir: effectiveOutDir,
        emitMaps: options.emitMaps,
        platformContext: effectivePlatformContext,
        treeShaking: options.treeShaking,
        boardPackage: effectiveBoardPackage,
        frameworkPackage: effectiveFrameworkPackage,
        debug: options.debug,
        force: options.force,
        skipTypeCheck: options.skipTypeCheck,
      });

      printDiagnostics(result.diagnostics);
      ui.printTasks(result.asyncTaskNames ?? [], result.usesTimers ?? false);
    }

    if (!options.compile) {
      ui.printSuccess();
      if (options.expect) {
        const exitCode = runExpectTests({
          port: options.port,
          buildTarget: (effectivePlatformContext?.frameworkData?.buildTarget as string | undefined) ?? (options.platformContext?.frameworkData?.buildTarget as string | undefined),
          baud: config?.console?.baudRate ?? options.baud,
          expectFile: options.expectFile,
        });
        process.exitCode = exitCode;
      }
      return;
    }

    // --compile (delegates to the active framework's toolchain)
    const buildTarget = (effectivePlatformContext?.frameworkData?.buildTarget as string | undefined) ?? (options.platformContext?.frameworkData?.buildTarget as string | undefined);
    const toolchainOpts = {
      outputDir: path.dirname(result.sourcePath),
      sourcePath: result.sourcePath,
      buildTarget,
      port: options.port,
      baud: options.baud ?? config?.console?.baudRate,
      optimize: config?.outputOptimize,
      extraFlags: config?.outputExtraFlags,
      defines: config?.outputDefines,
      frameworkConfig: config?.frameworkConfig,
    };

    ui.printCompiling(buildTarget ?? "native");
    let compileResult: import("@typehal/core/shared").CompileResult;
    try {
      compileResult = compileSource(toolchainOpts);
    } catch (compileError: any) {
      ui.printError(`Compile failed: ${compileError instanceof Error ? compileError.message : compileError}`);
      process.exitCode = 1;
      return;
    }
    printMappedCompileErrors(compileResult, result.sourceMapPath, result.sourcePath);
    if (!compileResult.success) {
      console.error(compileResult.output);
      process.exitCode = 1;
      return;
    }

    if (compileResult.memoryUsage) ui.printMemoryUsage(compileResult.memoryUsage);
      
    if (!options.upload) {
      ui.printSuccess();
      return;
    }

    // --upload
    const port = options.port!;
    ui.printUploading(port);
    const uploadResult = uploadFirmware(toolchainOpts);

    if (uploadResult.output) {
      console.log(uploadResult.output);
    }

    if (!uploadResult.success) {
      process.exitCode = 1;
      return;
    }

    if (!options.monitor && !options.expect) {
      ui.printSuccess();
      return;
    }

    if (options.monitor) {
      // --monitor (blocks until Ctrl+C)
      ui.printMonitoring(port, options.baud);
      monitorDevice(toolchainOpts);
      return;
    }

    // --expect: Run hardware tests after upload
    if (options.expect) {
      ui.printSuccess();
      const exitCode = runExpectTests({
        port: options.port,
        buildTarget,
        baud: config?.console?.baudRate ?? options.baud,
        expectFile: options.expectFile,
      });
      process.exitCode = exitCode;
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    ui.printError(message);
    process.exitCode = 1;
  }
}

main();