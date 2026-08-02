#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { parseCommandLine, printHelp } from "./utils/cli.js";
import type { GeneratedOutputs } from "./types.js";
import type { CreateCommandOptions, BoardAddCommandOptions } from "./types.js";
import { scaffoldProject, printInitNextSteps, KNOWN_TARGETS } from "./create/index.js";
import { runInitWizard } from "./create/index.js";
import { generateLibraryDefinitions, transpileFile } from "./transpile.js";
import { generateDecl, generateDeclsForDirectory, generateComponentDeclsForProject } from "./libdef/cpp-to-decl.js";
import { mapCppLocationToTs, readSourceMap, resolveMapPath, resolveSourceMapForSketch } from "./mapping/source-map.js";
import { compileSource, uploadFirmware, monitorDevice } from "./platform/toolchain.js";
import { resolveStrategy } from "./platform/registry.js";
import { loadFrameworkPackage } from "./framework-package.js";
import { getLoadedFramework, hasLoadedFramework } from "./framework-registry.js";
import { loadCuttlefishConfig, generateVirtualTypeDeclaration } from "./config-loader.js";
import { generateContractBoard } from "./contract/index.js";
import { requireUIHook, hasUIHook } from "./ui-hook.js";
import { loadUIEngine } from "./ui/ui-bridge.js";
import { loadSafetyEngine } from "./safety/safety-bridge.js";
import { runWatch, discoverWatchDirs } from "./watch.js";
import { runExpectTests, assertTypeScriptInput, printDiagnostics, printMappedCompileErrors } from "./cli-utils.js";
import { runPreviewServer } from "./preview/server.js";
import * as ui from "./utils/ui.js";
import chalk from "chalk";

function hasFatalDiagnostics(result: GeneratedOutputs): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function displayConfigForTranspile<T extends { configPath: string; display?: object }>(config: T | undefined): object | undefined {
  if (!config?.display) return undefined;
  const display = { ...(config.display as Record<string, unknown>) };
  if (typeof display.themeCss === "string" && !path.isAbsolute(display.themeCss as string)) {
    display.themeCss = path.resolve(path.dirname(config.configPath), display.themeCss as string);
  }
  return display;
}

async function handleCreate(options: CreateCommandOptions): Promise<void> {
  const targetId = options.target ?? options.board;
  const hasTarget = !!targetId;

  if (hasTarget) {
    const target = KNOWN_TARGETS.find(t => t.id === targetId);
    if (!target) {
      const available = KNOWN_TARGETS.map(t => `  - ${t.id} (${t.displayName})`).join("\n");
      throw new Error(
        `Unknown target '${targetId}'. Available targets:\n${available}`,
      );
    }

    const framework: string = options.framework ?? target.framework;
    const frameworkPackage = target.isNative
      ? target.frameworkPackage
      : framework === 'arduino'
        ? '@typecad/framework-arduino'
        : `@typecad/framework-${framework}`;

    const projectName = options.projectName || 'my-project';

    const result = scaffoldProject({
      projectName,
      targetId: target.id,
      targetDisplayName: target.displayName,
      isNative: target.isNative,
      architecture: target.architecture,
      boardPackage: target.boardPackage,
      frameworkPackage,
      framework,
      buildTarget: target.buildTarget,
      mcu: target.mcu,
      baudRate: target.isNative ? undefined : (options.baud ?? 9600),
      includeSketch: !options.noSketch,
      ...(target.frameworkData
        ? { frameworkData: target.frameworkData }
        : {}),
    }, options.outDir);

    console.log(`\n${chalk.green("✓")} Created project files:`);
    for (const file of result.createdFiles) {
      const relative = path.relative(process.cwd(), file);
      console.log(`  ${chalk.dim(relative || file)}`);
    }

    printInitNextSteps(result.options, result.outDir);
  } else {
    const wizardResult = await runInitWizard({
      projectName: options.projectName,
      board: options.board,
      framework: options.framework,
      baud: options.baud,
      noSketch: options.noSketch,
    });

    if (!wizardResult) {
      console.log(chalk.yellow("Project setup cancelled."));
      return;
    }

    const result = scaffoldProject(wizardResult, options.outDir);

    console.log(`\n${chalk.green("✓")} Created project files:`);
    for (const file of result.createdFiles) {
      const relative = path.relative(process.cwd(), file);
      console.log(`  ${chalk.dim(relative || file)}`);
    }

    printInitNextSteps(result.options, result.outDir);
  }
}

async function handleBoardAdd(options: BoardAddCommandOptions): Promise<void> {
  const { scaffoldBoardPackages, parseBoardSpec, generateFrameworkChecklist } = await import("./create/index.js");

  if (!fs.existsSync(options.specPath)) {
    throw new Error(`Spec file not found: ${options.specPath}`);
  }

  console.log(`Reading spec: ${options.specPath}`);
  const specText = fs.readFileSync(options.specPath, "utf8");
  const spec = parseBoardSpec(specText);

  console.log(`Generating board packages for ${spec.architecture} (${spec.boardName})...`);
  const result = scaffoldBoardPackages(spec, { force: options.force });

  console.log(`\nCreated ${result.createdFiles.length} files:`);
  for (const f of result.createdFiles) {
    console.log(`  ${path.relative(process.cwd(), f)}`);
  }

  console.log(generateFrameworkChecklist(spec));
}

/**
 * `cuttlefish doctor` — verify the active framework's environment. The actual
 * detection logic is framework-owned (e.g. framework-arduino checks arduino-cli
 * and the board core). Cuttlefish only dispatches: it forwards to the loaded
 * framework's `doctor` export, or reports that the framework provides none.
 *
 * Doctor is a user-facing diagnostic command, so it must not throw if no
 * framework is loaded yet (the user may run it before any build). The
 * hasLoadedFramework() guard returns a safe optional instead.
 */
function runDoctor(): void {
  const fw = hasLoadedFramework() ? getLoadedFramework() : undefined;
  if (!fw?.doctor) {
    ui.printInfo("This framework provides no doctor support.");
    return;
  }
  fw.doctor();
}

async function main(): Promise<void> {
  try {
    const options = parseCommandLine(process.argv);

    if (options === "help") {
      printHelp();
      return;
    }

    if (options.command === "create") {
      await handleCreate(options);
      return;
    }

    if (options.command === "board-add") {
      await handleBoardAdd(options);
      return;
    }

    if (options.command === "preview") {
      await runPreviewServer({
        configPath: options.configPath,
        port: options.port ? Number(options.port) : undefined,
      });
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

    if (options.command === "doctor") {
      runDoctor();
      return;
    }

    if (options.command === "licenses") {
      const fw = hasLoadedFramework() ? getLoadedFramework() : undefined;
      if (!fw?.licenses) {
        ui.printInfo("This framework provides no licenses support.");
        return;
      }
      fw.licenses(options.strict ?? false, options.all ?? false);
      return;
    }

    // ── Handle build command — entry point comes from config ──────────
    if (options.command === "build") {
      const buildConfig = loadCuttlefishConfig(process.cwd());
      if (!buildConfig) {
        throw new Error(
          "No cuttlefish.config.ts found in current directory.\n" +
          "Run 'cuttlefish create' to create one, or use: cuttlefish <input.ts> [options]",
        );
      }
      if (!buildConfig.entry) {
        throw new Error(
          "cuttlefish.config.ts has no 'entry' field.\n" +
          "Add: entry: './src/sketch.ts'",
        );
      }

      const entryFile = path.resolve(path.dirname(buildConfig.configPath), buildConfig.entry);
      if (!fs.existsSync(entryFile)) {
        throw new Error(`Entry file not found: ${entryFile}`);
      }

      assertTypeScriptInput(entryFile);
      (options as any).inputFile = entryFile;
      // The project root (directory holding cuttlefish.config.ts) is where the
      // ESLint gate looks for .cuttlefish/eslint.config.mjs. Threading it through
      // keeps the gate from silently no-op'ing when entry lives under src/.
      options.projectRoot = path.dirname(buildConfig.configPath);
      // Pass display config from cuttlefish.config.ts through to transpileFile
      if (buildConfig.display) {
        (options as any).display = displayConfigForTranspile(buildConfig);
      }
    }

    // gen-decls runs before the !options.inputFile guard below: in --all mode
    // it intentionally has no inputFile (it scans scanDir instead), so the
    // generic "Missing input file path" check would otherwise block it.
    if (options.command === "gen-decls") {
      // Check for --components flag (ESP-IDF components: managed + local).
      // Runs before scanDir/single-file branches; components mode has no
      // inputFile by design (it scans managed_components/ + components/).
      const componentsDir = (options as any).componentsDir as string | undefined;
      if (componentsDir) {
        ui.printHeader();
        ui.printStep(`Generating component declarations for ${componentsDir}...`);
        const config = loadCuttlefishConfig(componentsDir);
        const frameworkConfig = (config?.frameworkConfig ?? {}) as Record<string, unknown>;
        const componentsNode = (frameworkConfig as any)?.components ?? {};
        const managedSpecs = Object.keys(componentsNode.managed ?? {}) as string[];
        // idf.py stores managed deps as <namespace>__<name> (slashes → __).
        const managedNames = managedSpecs.map((spec) => spec.replace("/", "__"));
        const localPaths = ((componentsNode.local as string[]) ?? []).map((p: string) =>
          path.isAbsolute(p) ? p : path.resolve(componentsDir, p),
        );
        const builtinNames = (componentsNode.builtin as string[]) ?? [];
        const created = generateComponentDeclsForProject(componentsDir, {
          managed: managedNames,
          local: localPaths,
          builtin: [],
          idfRoot: undefined,
        });
        if (created.length === 0) {
          ui.printInfo("No component declaration files created.");
        } else {
          ui.printSuccess(`Created ${created.length} declaration file(s):`);
          for (const f of created) ui.printFileCreated(f);
        }
        return;
      }

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

      // Single file mode - C++ header or source expected
      if (!options.inputFile) {
        throw new Error("Missing input C++ file path. Use: gen-decls <file.h|file.cpp> or gen-decls --all <directory>");
      }
      const extension = path.extname(options.inputFile).toLowerCase();
      if (extension !== ".cpp" && extension !== ".h") {
        throw new Error(`gen-decls expects a .h or .cpp file, received '${extension || "<no extension>"}'.`);
      }

      ui.printHeader();
      ui.printStep("Generating declarations...");
      const created = generateDecl(options.inputFile);
      if (created) {
        ui.printSuccess(`Created: ${created}`);
      } else {
        ui.printInfo("No declaration file created (no classes or constants found).");
      }
      return;
    }

    if (!options.inputFile) {
      if (options.expect) {
        const config = loadCuttlefishConfig(process.cwd());
        const exitCode = runExpectTests({
          port: options.port ?? config?.console?.port,
          buildTarget: config?.buildTarget,
          baud: config?.console?.baudRate ?? options.baud,
          expectFile: options.expectFile,
        });
        process.exitCode = exitCode;
        return;
      }
      throw new Error("Missing input file path.");
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

    // ── Load cuttlefish.config.ts (config wins over CLI flags) ──────────
    const inputDir = path.dirname(path.resolve(options.inputFile));
    const config = loadCuttlefishConfig(inputDir);

    // ── Contract-based board narrowing ──────────────────────────────────
    // If the config names a TypeCAD contract (*.contract.json from typecad.net),
    // generate the narrowed `.cuttlefish/board.ts` BEFORE env.d.ts is written
    // (it emits `export * from './board.js'` for this case) and before the
    // board package is resolved downstream. The generated board re-exports
    // only the pins/peripherals the PCB actually wires.
    if (config?.contract) {
      await generateContractBoard(config);
    }

    // ── Pre-transpile: generate component .d.ts stubs ───────────────────
    // The transpile type-check needs the .d.ts imports in main.ts to resolve.
    // For ESP-IDF builtin/managed/local components, those .d.ts files are
    // generated by gen-decls — so we must run it BEFORE type-checking, not
    // only as part of --compile. The cache is written under the transpile
    // output dir (the same path --compile uses), so user imports resolve
    // identically in both flows.
    if (config?.frameworkConfig) {
      const fc = config.frameworkConfig as Record<string, unknown>;
      const componentsNode = (fc as any)?.components ?? {};
      const managedSpecs = Object.keys(componentsNode.managed ?? {}) as string[];
      const localPaths = ((componentsNode.local as string[]) ?? []).map((p: string) =>
        path.isAbsolute(p) ? p : path.resolve(inputDir, p),
      );
      const builtinNames = (componentsNode.builtin as string[]) ?? [];
      if (managedSpecs.length > 0 || localPaths.length > 0 || builtinNames.length > 0) {
        // Resolve the transpile output dir — the cache lives under it so the
        // framework's compile path and this pre-transpile pass agree on location.
        // output.outDir in config is relative to the project root (inputDir);
        // if absent, the transpile output goes alongside the entry file.
        const outBase = config.outputOutDir
          ? path.resolve(inputDir, config.outputOutDir)
          : inputDir;
        try {
          generateComponentDeclsForProject(outBase, {
            managed: managedSpecs.map((s) => s.replace('/', '__')),
            local: localPaths,
            builtin: [],
            idfRoot: undefined,
          });
        } catch {
          // Non-fatal: if gen-decls fails (e.g. component not yet fetched),
          // the type-checker will surface the missing-import errors with
          // clearer context than crashing here.
        }
      }
    }

    // Load the UI engine (if @typecad/ui is installed) before any UI work.
    await loadUIEngine();

    // Load the safety engine (if @typecad/safety is installed) before any
    // safety work.
    await loadSafetyEngine();

    let effectivePlatformContext = options.platformContext;
    let effectiveTarget = options.target;
    let effectiveOutDir = options.outDir;
    let effectiveBoardPackage = options.boardPackage;
    let effectiveFrameworkPackage = options.frameworkPackage;
    let effectiveMcuPackage: string | undefined;
    let effectivePort = options.port;

    if (config) {
      if (config.mcu) {
        effectiveMcuPackage = config.mcu;
      }
      // Config port is the default; CLI --port flag overrides it.
      if (!effectivePort && config.console?.port) {
        effectivePort = config.console.port;
      }
      if (config.board || config.mcu) {
        effectiveBoardPackage = config.board || config.mcu;
      }
      
      let configBuildTarget = config.buildTarget;

      if (configBuildTarget) {
        // Reconstruct frameworkData from buildTarget, preserving other fields
        // (psram, components, etc.) from the resolved frameworkConfig so the
        // transpile-time diagnostics (e.g. scroll-canvas-memory PSRAM budget)
        // and the toolchain both see the full frameworkData, not just buildTarget.
        const fcPsram = (config.frameworkConfig as any)?.psram;
        effectivePlatformContext = {
          architecture: configBuildTarget.split(":")?.[1]?.toLowerCase(),
          frameworkData: {
            buildTarget: configBuildTarget,
            ...(fcPsram ? { psram: fcPsram } : {}),
          },
        };
      }
      if (config.outputOutDir && !options.outDir) {
        effectiveOutDir = path.resolve(inputDir, config.outputOutDir);
      }
      if (config.framework) {
        effectiveFrameworkPackage = config.framework;
      }
      if (config.target) {
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

      // Keep cuttlefish-env.d.ts in sync so the TS language server can resolve
      // '@typecad/board' imports in editor without a linter error.
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
      // @typecad/ui is optional — skip UI type-decl generation when the engine
      // is not loaded (no UI modules exist to declare).
      if (hasUIHook()) {
        requireUIHook().generateProjectUITypeDeclarations(path.dirname(config.configPath));
      }
    }

    // Print branded header and build info
    ui.printHeader();
    ui.printBuildInfo({
      framework: effectiveFrameworkPackage,
      mcu: effectiveMcuPackage,
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
          diagnostics: options.diagnostics,
          display: displayConfigForTranspile(config),
          projectRoot: options.projectRoot,
          autosar: options.autosar,
          autosarArxml: options.autosarArxml,
        });

        printDiagnostics(result.diagnostics);
        ui.printTasks(result.asyncTaskNames ?? [], result.usesTimers ?? false);
        if (result.diagnosticsReportPath) {
          ui.printInfo(`Diagnostics report: ${result.diagnosticsReportPath}`);
        }

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
              port: effectivePort,
              baud: options.baud ?? config?.console?.baudRate,
              optimize: config?.outputOptimize,
              extraFlags: config?.outputExtraFlags,
              defines: config?.outputDefines,
              frameworkConfig: config?.frameworkConfig,
              zephyrConfig: config?.zephyrConfig,
              debug: options.debug,
            };
            ui.printCompiling(buildTarget ?? "native");
            const compileResult = compileSource(watchOpts);
            printMappedCompileErrors(compileResult, result.sourceMapPath, result.sourcePath, path.dirname(result.sourcePath));

            if (compileResult.success) {
              if (compileResult.memoryUsage) ui.printMemoryUsage(compileResult.memoryUsage);
              
              if (options.upload && effectivePort) {
                ui.printUploading(effectivePort);
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
          console.log(chalk.cyan(`⤳ Cuttlefish`) + chalk.gray(` v0.1.0`));
          console.log();
          ui.printInfo(`[${timestamp}] Change detected: ${relativePath}`);
          console.log();

          try {
            if (config) {
              // @typecad/ui is optional — skip UI type-decl generation when the
              // engine is not loaded (no UI modules exist to declare).
              if (hasUIHook()) {
                requireUIHook().generateProjectUITypeDeclarations(path.dirname(config.configPath));
              }
            }
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
              diagnostics: options.diagnostics,
              display: displayConfigForTranspile(config),
              projectRoot: options.projectRoot,
              autosar: options.autosar,
              autosarArxml: options.autosarArxml,
            });

            printDiagnostics(rebuildResult.diagnostics);
            ui.printTasks(rebuildResult.asyncTaskNames ?? [], rebuildResult.usesTimers ?? false);
            if (rebuildResult.diagnosticsReportPath) {
              ui.printInfo(`Diagnostics report: ${rebuildResult.diagnosticsReportPath}`);
            }

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
                  port: effectivePort,
                  baud: options.baud ?? config?.console?.baudRate,
                  optimize: config?.outputOptimize,
                  extraFlags: config?.outputExtraFlags,
                  defines: config?.outputDefines,
                  frameworkConfig: config?.frameworkConfig,
                  zephyrConfig: config?.zephyrConfig,
                  debug: options.debug,
                };
                ui.printCompiling(buildTarget ?? "native");
                const compileResult = compileSource(rebuildOpts);
                printMappedCompileErrors(compileResult, rebuildResult.sourceMapPath, rebuildResult.sourcePath, path.dirname(rebuildResult.sourcePath));

                if (compileResult.success) {
                  if (compileResult.memoryUsage) ui.printMemoryUsage(compileResult.memoryUsage);

                  if (options.upload && effectivePort) {
                    ui.printUploading(effectivePort);
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
    let result: GeneratedOutputs;

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
        diagnostics: options.diagnostics,
        display: displayConfigForTranspile(config) ?? (options as any).display,
        projectRoot: options.projectRoot,
        autosar: options.autosar,
        autosarArxml: options.autosarArxml,
      });

      printDiagnostics(result.diagnostics);
      ui.printTasks(result.asyncTaskNames ?? [], result.usesTimers ?? false);
      if (result.diagnosticsReportPath) {
        ui.printInfo(`Diagnostics report: ${result.diagnosticsReportPath}`);
      }
    }

    if (hasFatalDiagnostics(result)) {
      ui.printError("Transpilation failed. Fix the transpiler diagnostics above before compiling.");
      process.exitCode = 1;
      return;
    }

    if (!options.compile) {
      ui.printSuccess();
      if (options.expect) {
        const exitCode = runExpectTests({
          port: effectivePort,
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
      port: effectivePort,
      baud: options.baud ?? config?.console?.baudRate,
      optimize: config?.outputOptimize,
      extraFlags: config?.outputExtraFlags,
      defines: config?.outputDefines,
      frameworkConfig: config?.frameworkConfig,
      zephyrConfig: config?.zephyrConfig,
      debug: options.debug,
    };

    ui.printCompiling(buildTarget ?? "native");
    let compileResult: import("./api/shared/index.js").CompileResult;
    try {
      compileResult = compileSource(toolchainOpts);
    } catch (compileError: any) {
      ui.printError(`Compile failed: ${compileError instanceof Error ? compileError.message : compileError}`);
      process.exitCode = 1;
      return;
    }
    const mapped = printMappedCompileErrors(compileResult, result.sourceMapPath, result.sourcePath, path.dirname(result.sourcePath));
    if (!compileResult.success) {
      // Only dump the raw compiler output if the mapper produced nothing —
      // e.g. linker errors or g++ diagnostics that didn't parse into structured
      // errors. When errors were mapped, the mapper already rendered them
      // against the TypeScript source (mapped primary + demoted C++ fallback),
      // so re-dumping the raw g++ stderr would just repeat them at their C++
      // locations and defeat the mapping.
      if (!mapped.printed) {
        console.error(compileResult.output);
      }
      process.exitCode = 1;
      return;
    }

    if (compileResult.memoryUsage) ui.printMemoryUsage(compileResult.memoryUsage);
      
    if (!options.upload) {
      ui.printSuccess();
      return;
    }

    // --upload (requires a port from --port flag or config.console.port)
    if (!effectivePort) {
      throw new Error("--upload requires a port. Set --port <port> on the command line or console.port in cuttlefish.config.ts.");
    }
    const port = effectivePort;
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
      // --monitor (blocks until Ctrl+C). Show the resolved baud (config ?? --baud)
      // in the banner — toolchainOpts.baud is built the same way, so what the
      // user sees is what the framework monitor opens the port at.
      ui.printMonitoring(port, toolchainOpts.baud ?? 115200);
      monitorDevice(toolchainOpts);
      return;
    }

    // --expect: Run hardware tests after upload
    if (options.expect) {
      ui.printSuccess();
      const exitCode = runExpectTests({
        port: effectivePort,
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
