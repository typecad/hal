#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { parseCommandLine, printHelp } from "./utils/cli.js";
import type { GeneratedOutputs } from "./types.js";
import type { CreateCommandOptions, BoardAddCommandOptions } from "./types.js";
import { runLibraryCommand } from "./library/cli.js";
import type { ScaffoldProjectResult } from "./create/index.js";
import { scaffoldProject, printCreateNextSteps, KNOWN_TARGETS, frameworksForTarget, frameworkCatalogEntry, frameworkCompatibleWithTarget, FRAMEWORK_CATALOG, frameworkTargetProfile, probeMethodsForBoard } from "./create/index.js";
import { generateFrameworkDebugArtifacts } from "./create/debug-artifacts.js";
import { runCreateWizard } from "./create/index.js";
import { installProjectDependencies } from "./create/install-deps.js";
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

/**
 * Apply the PSRAM config to the Arduino build: append the `PSRAM={opi|quad}`
 * menu option to the FQBN (so the Arduino core's psramFound()/ps_malloc work
 * at runtime — they're gated on the board menu option, not just the define)
 * and add `-DBOARD_HAS_PSRAM` to the defines (so the framework's PSRAM canvas
 * allocator is compiled in). No-op when psram is unset or the target isn't an
 * Arduino FQBN (the PSRAM= option is Arduino-core-specific).
 */
function applyPsramToArduinoBuild(
  buildTarget: string | undefined,
  defines: Record<string, string> | undefined,
  psram: 'opi' | 'quad' | undefined,
): { buildTarget: string | undefined; defines: Record<string, string> } {
  if (!psram || !buildTarget || !buildTarget.includes(':')) {
    return { buildTarget, defines: defines ?? {} };
  }
  // Arduino FQBN config options follow the board:option as `key=value` pairs.
  // Append PSRAM= if not already present (don't clobber an explicit override).
  const psramOpt = `PSRAM=${psram}`;
  const adjustedTarget = buildTarget.includes('PSRAM=') ? buildTarget : `${buildTarget}:${psramOpt}`;
  const adjustedDefines = { ...(defines ?? {}) };
  if (!('BOARD_HAS_PSRAM' in adjustedDefines)) adjustedDefines.BOARD_HAS_PSRAM = '';
  return { buildTarget: adjustedTarget, defines: adjustedDefines };
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

    // Resolve the framework. --framework wins (validated against the board's
    // compatible set); otherwise narrow via the catalog for the chosen board
    // and auto-pick when exactly one is compatible.
    let frameworkId: string;
    let frameworkPackage: string;
    if (options.framework) {
      const requested = frameworkCatalogEntry(options.framework);
      if (!requested) {
        const available = FRAMEWORK_CATALOG.filter(f => f.installable).map(f => f.id).join(", ");
        throw new Error(`Unknown framework '${options.framework}'. Available: ${available}`);
      }
      if (!frameworkCompatibleWithTarget(target, requested.id)) {
        const list = frameworksForTarget(target).filter(f => f.installable).map(f => f.id).join(", ");
        throw new Error(
          `Framework '${requested.id}' is not compatible with target '${target.id}' (${target.displayName}). ` +
          `Compatible frameworks: ${list}`,
        );
      }
      frameworkId = requested.id;
      frameworkPackage = requested.packageName;
    } else {
      const compatible = frameworksForTarget(target).filter(f => f.installable);
      if (compatible.length === 1) {
        frameworkId = compatible[0]!.id;
        frameworkPackage = compatible[0]!.packageName;
      } else {
        const list = compatible.map(f => f.id).join(", ");
        throw new Error(
          `Target '${target.id}' is compatible with multiple frameworks (${list}). ` +
          `Pass --framework <id> to choose one.`,
        );
      }
    }

    // Probe methods (Zephyr boards whose packages ship a table). An explicit
    // --probe id is validated against the catalog so a typo fails at create
    // time, not at the first upload.
    const probeMethods = frameworkId === 'zephyr' ? probeMethodsForBoard(target.id) : [];
    if (options.probe && probeMethods.length > 0 && !probeMethods.some(m => m.id === options.probe)) {
      const list = probeMethods.map(m => `${m.id} (${m.description})`).join('; ');
      throw new Error(
        `Unknown probe method '${options.probe}' for ${target.displayName}. Supported: ${list}.`,
      );
    }

    const projectName = options.projectName || 'my-project';

    // Framework-specific build target + toolchain (Zephyr board id + 'west' vs
    // the Arduino FQBN + 'arduino-cli').
    const profile = frameworkTargetProfile(target, frameworkId);

    const result = scaffoldProject({
      probeMethod: options.probe,
      probeMethods,
      projectName,
      targetId: target.id,
      targetDisplayName: target.displayName,
      isNative: target.isNative,
      architecture: target.architecture,
      boardPackage: target.boardPackage,
      frameworkPackage,
      framework: frameworkId,
      buildTarget: profile.buildTarget ?? target.buildTarget,
      ...(profile.toolchainType ? { toolchainType: profile.toolchainType } : {}),
      mcu: target.mcu,
      baudRate: target.isNative ? undefined : (options.baud ?? 9600),
      includeSketch: !options.noSketch,
      ...(target.frameworkData
        ? { frameworkData: target.frameworkData }
        : {}),
    }, options.outDir);

    finalizeCreate(result, options);
  } else {
    const wizardResult = await runCreateWizard({
      projectName: options.projectName,
      board: options.board,
      framework: options.framework,
      baud: options.baud,
      noSketch: options.noSketch,
      probe: options.probe,
    });

    if (!wizardResult) {
      console.log(chalk.yellow("Project setup cancelled."));
      return;
    }

    const result = scaffoldProject(wizardResult, options.outDir);

    finalizeCreate(result, options);
  }
}

/**
 * Shared tail of `cuttlefish create`: list the created files, install the new
 * project's dependencies (so it's ready to build with no extra step — skipped
 * via --no-install), and print the next-steps. A failed install is non-fatal:
 * the scaffold itself is valid, so we warn and point at the manual command
 * rather than undoing anything.
 */
function finalizeCreate(result: ScaffoldProjectResult, options: CreateCommandOptions): void {
  console.log(`\n${chalk.green("✓")} Created project files:`);
  for (const file of result.createdFiles) {
    const relative = path.relative(process.cwd(), file);
    console.log(`  ${chalk.dim(relative || file)}`);
  }

  let installed = false;
  if (!options.noInstall) {
    try {
      const { pm } = installProjectDependencies({ projectDir: result.outDir });
      installed = true;
      console.log(`\n${chalk.green("✓")} Installed dependencies via ${pm}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const relativeDir = path.relative(process.cwd(), result.outDir) || '.';
      console.log(`\n${chalk.yellow("!")} Could not install dependencies automatically: ${message}`);
      console.log(chalk.dim(`  Run '${chalk.white("npm install")}' manually in ${relativeDir} when ready.`));
    }
  }

  // Framework starter debug profile (e.g. Zephyr esp32s3): write .vscode/
  // launch.json + tasks.json so F5 in VS Code works before the first build.
  // Runs after the install step so the framework package resolves from the
  // new project's node_modules; best-effort — the first --debug build writes
  // the artifacts anyway.
  const debugArtifacts = generateFrameworkDebugArtifacts({
    frameworkPackage: result.options.frameworkPackage || undefined,
    workspaceRoot: result.outDir,
    buildTarget: result.options.buildTarget,
  });
  if (debugArtifacts.length > 0) {
    console.log(`\n${chalk.green("✓")} Debug profile: ${debugArtifacts.map((f) => chalk.white(f)).join(", ")}`);
  }

  printCreateNextSteps(result.options, result.outDir, { installed, debugProfile: debugArtifacts.length > 0 });
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

    if (options.command === "library") {
      await runLibraryCommand(options);
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

    if (options.command === "doctor" || options.command === "licenses") {
      // These commands run standalone (often before a build), so the framework
      // isn't loaded yet. Load it from the config's framework field so the
      // framework-supplied doctor/licenses handlers are available.
      if (!hasLoadedFramework()) {
        const config = loadCuttlefishConfig(process.cwd());
        if (config?.framework) {
          try {
            loadFrameworkPackage(config.framework, process.cwd());
          } catch {
            // Framework package not resolvable — fall through to the
            // no-support message below rather than crashing the command.
          }
        }
      }
      const fw = hasLoadedFramework() ? getLoadedFramework() : undefined;
      if (options.command === "doctor") {
        if (!fw?.doctor) {
          ui.printInfo("This framework provides no doctor support.");
          return;
        }
        fw.doctor();
        return;
      }
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
    // CUTTLEFISH_PORT env var sits between the CLI flag and the config file
    // (flag > env > config), so cross-platform uploads don't need a
    // Windows-specific COM port baked into package.json scripts.
    if (!effectivePort && process.env.CUTTLEFISH_PORT) {
      effectivePort = process.env.CUTTLEFISH_PORT;
    }

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
        // Reconstruct frameworkData from buildTarget so the toolchain sees the
        // full frameworkData, not just buildTarget.
        effectivePlatformContext = {
          architecture: configBuildTarget.split(":")?.[1]?.toLowerCase(),
          frameworkData: {
            buildTarget: configBuildTarget,
            // Thread the PSRAM type through to the framework so it can emit the
            // PSRAM-enabling Kconfig (Zephyr) / define + FQBN option (Arduino).
            ...(config.psram ? { psram: config.psram } : {}),
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
            const baseBuildTarget = (effectivePlatformContext?.frameworkData?.buildTarget as string | undefined) ?? (options.platformContext?.frameworkData?.buildTarget as string | undefined);
            const { buildTarget, defines: psramDefines } = applyPsramToArduinoBuild(baseBuildTarget, config?.outputDefines, config?.psram);
            const watchOpts = {
              outputDir: path.dirname(result.sourcePath),
              sourcePath: result.sourcePath,
              buildTarget,
              port: effectivePort,
              baud: options.baud ?? config?.console?.baudRate,
              extraFlags: config?.outputExtraFlags,
              defines: psramDefines,
              psram: config?.psram,
              frameworkConfig: config?.frameworkConfig,
              zephyrConfig: config?.zephyrConfig,
              display: displayConfigForTranspile(config) as Record<string, unknown> | undefined,
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
                const baseBuildTarget = (effectivePlatformContext?.frameworkData?.buildTarget as string | undefined) ?? (options.platformContext?.frameworkData?.buildTarget as string | undefined);
                const { buildTarget, defines: psramDefines } = applyPsramToArduinoBuild(baseBuildTarget, config?.outputDefines, config?.psram);
                const rebuildOpts = {
                  outputDir: path.dirname(rebuildResult.sourcePath),
                  sourcePath: rebuildResult.sourcePath,
                  buildTarget,
                  port: effectivePort,
                  baud: options.baud ?? config?.console?.baudRate,
                  extraFlags: config?.outputExtraFlags,
                  defines: psramDefines,
                  psram: config?.psram,
                  frameworkConfig: config?.frameworkConfig,
                  zephyrConfig: config?.zephyrConfig,
              display: displayConfigForTranspile(config) as Record<string, unknown> | undefined,
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
    const baseBuildTarget = (effectivePlatformContext?.frameworkData?.buildTarget as string | undefined) ?? (options.platformContext?.frameworkData?.buildTarget as string | undefined);
    const { buildTarget, defines: psramDefines } = applyPsramToArduinoBuild(baseBuildTarget, config?.outputDefines, config?.psram);
    const toolchainOpts = {
      outputDir: path.dirname(result.sourcePath),
      sourcePath: result.sourcePath,
      buildTarget,
      port: effectivePort,
      baud: options.baud ?? config?.console?.baudRate,
      extraFlags: config?.outputExtraFlags,
      defines: psramDefines,
      psram: config?.psram,
      frameworkConfig: config?.frameworkConfig,
      // --probe <method> overrides zephyr.probe from the config for this run.
      zephyrConfig: options.probe
        ? { ...(config?.zephyrConfig ?? {}), probe: options.probe }
        : config?.zephyrConfig,
              display: displayConfigForTranspile(config) as Record<string, unknown> | undefined,
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
