#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { parseCommandLine, printHelp } from "./utils/cli.js";
import type { GeneratedOutputs } from "./types.js";
import type { CreateCommandOptions } from "./types.js";
import type { CleanCommandOptions, DebugServerCommandOptions } from "./types.js";
import { runClean } from "./clean.js";
import { runLibraryCommand } from "./library/cli.js";
import type { ScaffoldProjectResult } from "./create/index.js";
import { scaffoldProject, printCreateNextSteps, KNOWN_TARGETS, frameworksForTarget, frameworkCatalogEntry, FRAMEWORK_CATALOG, frameworkTargetProfile, probeMethodsForBoard, probeRunnerQuirks, starterAppRel } from "./create/index.js";
import { findPackBoard, packBoardAsTarget } from "./create/pack-targets.js";
import { activeBoardCatalog, assertZephyrSdkForCreate, formatZephyrSdkFound, ensureFreshBoardCatalog, resetBoardCatalogOverlayCache, sdkFingerprint, PINNED_ZEPHYR_MANIFEST_REV } from "./board-catalog/index.js";
import { generateFrameworkDebugArtifacts } from "./create/debug-artifacts.js";
import { runCreateWizard } from "./create/index.js";
import { installProjectDependencies } from "./create/install-deps.js";
import { transpileFile } from "./transpile.js";
import { generateDecl, generateDeclsForDirectory } from "./libdef/cpp-to-decl.js";
import { resolveSourceMapForProgram } from "./mapping/source-map.js";
import { compileSource, uploadFirmware, monitorDevice, debugServer } from "./platform/toolchain.js";
import { resolveStrategy } from "./platform/registry.js";
import { loadFrameworkPackage } from "./framework-package.js";
import { getLoadedFramework, hasLoadedFramework } from "./framework-registry.js";
import { loadTypecadConfig, generateVirtualTypeDeclaration, regenBoardModule } from "./config-loader.js";
import { generateContractBoard } from "./contract/index.js";
import { requireUIHook, hasUIHook } from "./ui-hook.js";
import { loadUIEngine } from "./ui/ui-bridge.js";
import { loadSafetyEngine } from "./safety/safety-bridge.js";
import { runWatch, discoverWatchDirs } from "./watch.js";
import { runExpectTests, runTestRunner, assertTypeScriptInput, printDiagnostics, printMappedCompileErrors } from "./cli-utils.js";
import { runPreviewServer } from "./preview/server.js";
import * as ui from "./utils/ui.js";
import chalk from "chalk";

function hasFatalDiagnostics(result: GeneratedOutputs): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

/** The board-catalog hooks the Zephyr strategy exposes — structurally typed
 *  (cuttlefish cannot import framework-zephyr types at build time; the
 *  framework is loaded at runtime, same as the BoardGenStrategy pattern in
 *  config-loader). */
interface BoardCatalogStrategy {
  syncBoardCatalog?(zephyrBase?: string): {
    zephyrBase: string;
    overlayPath: string;
    provenance: { version: string; gitHead?: string };
    stats: { variants: number; withFacts: number; failures: number; droppedYamls: number };
    added: readonly string[];
    changed: readonly string[];
    removed: readonly string[];
  };
  ensureFreshBoardCatalog?(): unknown;
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

  // SDK gate: the installed Zephyr SDK is the source of truth — boards, pin
  // data, everything derives from it. No SDK (or a wrong-version one) means
  // the project cannot work; fail with the fix instead of scaffolding junk.
  // Native-desktop projects are the one exception (no Zephyr involved).
  const wantsNative = options.framework === "native" || (!options.framework && targetId === "native");
  if (!wantsNative) {
    // The gate doubles as the lookup — its ok-return carries everything the
    // printout needs (no second discovery pass).
    const sdk = assertZephyrSdkForCreate();
    if (sdk) {
      console.log(chalk.gray('  Zephyr SDK:'));
      for (const line of formatZephyrSdkFound(sdk)) console.log(chalk.gray(line));
    }
    // Build/refresh the board registry from the installed SDK now — the
    // wizard's board list and --board resolution below read it.
    ensureFreshBoardCatalog();
    resetBoardCatalogOverlayCache();
  }

  // Preseeded targets run non-interactively ONLY when stdin is not a TTY
  // (scripts/CI pipe nothing and expect zero prompts). A human typing
  // `typecad-hal create x --board <target>` still gets the wizard — it
  // prints the preseeded answers and asks only what was not specified
  // (probe method, serial port, baud, starter).
  const interactive = process.stdin.isTTY === true;
  if (hasTarget && !interactive) {
    // Target resolution: --target/--board names the native target or any
    // board from the catalog (a qualified target like
    // 'nucleo_f411re/stm32f411xe', or a bare board id).
    let target = KNOWN_TARGETS.find(t => t.id === targetId)
      ?? (() => {
        const pack = findPackBoard(targetId!);
        return pack ? packBoardAsTarget(pack) : undefined;
      })();
    if (!target) {
      // No catalog on this machine (or a typo). A QUALIFIED target passes
      // through raw: the first build syncs the catalog from the Zephyr tree
      // and validates it there, where the real error is actionable.
      if (targetId!.includes("/")) {
        target = packBoardAsTarget({
          identifier: targetId!,
          name: targetId!,
          soc: targetId!.split("/")[1] ?? "",
        });
      } else {
        const known = KNOWN_TARGETS.map(t => `  - ${t.id} (${t.displayName})`);
        throw new Error(
          `Unknown target '${targetId}'. Built-in targets:\n${known.join("\n")}\n` +
          `Or pass any board from the catalog (e.g. --board nucleo_f411re/stm32f411xe) —\n` +
          `the catalog comes from your Zephyr tree; run \`typecad-hal board sync\` (or the\n` +
          `installer) to generate it.`,
        );
      }
    }

    const compatibleFrameworks = frameworksForTarget(target)
      .filter(f => f.installable);

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
      if (!compatibleFrameworks.some(f => f.id === requested.id)) {
        const list = compatibleFrameworks.map(f => f.id).join(", ");
        throw new Error(
          `Framework '${requested.id}' is not compatible with target '${target.id}' (${target.displayName}). ` +
          `Compatible frameworks: ${list}`,
        );
      }
      frameworkId = requested.id;
      frameworkPackage = requested.packageName;
    } else {
      if (compatibleFrameworks.length === 1) {
        frameworkId = compatibleFrameworks[0]!.id;
        frameworkPackage = compatibleFrameworks[0]!.packageName;
      } else {
        const list = compatibleFrameworks.map(f => f.id).join(", ");
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

    // Board-catalog quirk for the chosen probe method (e.g. an srst-based
    // openocd.cfg behind a debug header with no NRST) — baked into the
    // scaffolded config's runnerArgs so the first flash works.
    const probeRunnerArgs =
      options.probe && frameworkId === 'zephyr' ? probeRunnerQuirks(target.id, options.probe) : [];

    // Framework-specific build target + toolchain (Zephyr board id + 'west').
    const profile = frameworkTargetProfile(target, frameworkId);
    const buildTarget = profile.buildTarget ?? target.buildTarget;

    const result = scaffoldProject({
      probeMethod: options.probe,
      probeMethods,
      ...(probeRunnerArgs.length > 0 ? { probeRunnerArgs } : {}),
      projectName,
      targetId: target.id,
      targetDisplayName: target.displayName,
      isNative: target.isNative,
      architecture: target.architecture,
      board: target.board,
      // Pack fact: does the board's devicetree declare an LED? Drives the
      // starter between LED-blink and console-heartbeat (384 of 1,248 pack
      // boards ship no gpio-leds node).
      ...(target.board ? { hasLed: Boolean(activeBoardCatalog()[target.board]?.led) } : {}),
      frameworkPackage,
      framework: frameworkId,
      buildTarget,
      ...(profile.toolchainType ? { toolchainType: profile.toolchainType } : {}),
      // soc rides the config only for bare-silicon/contract projects — a
      // board target's soc derives from the identifier at boardgen time.
      ...(target.board ? {} : { soc: target.soc }),
      // Zephyr consoles default 115200; the 9600 default is the Arduino-class
      // convention.
      baudRate: target.isNative ? undefined : (options.baud ?? (frameworkId === 'zephyr' ? 115200 : 9600)),
      includeStarter: !options.noStarter,
      ...(options.port ? { port: options.port } : {}),
      ...(target.frameworkData
        ? { frameworkData: target.frameworkData }
        : {}),
    }, options.outDir);

    finalizeCreate(result, options);
  } else {
    const wizardResult = await runCreateWizard({
      projectName: options.projectName,
      board: options.board ?? options.target,
      framework: options.framework,
      baud: options.baud,
      noStarter: options.noStarter,
      probe: options.probe,
      port: options.port,
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
 * `typecad-hal clean` — remove the resolved generated output dir. The escape
 * hatch for states a build cannot self-heal (a build dir wedged by an
 * SDK/Zephyr-tree change, orphans from a toolchain upgrade, reclaiming the
 * Zephyr build tree). Resolution mirrors build: --out-dir flag > the config's
 * output.outDir against the entry's dir; the entry file itself may be missing
 * (recovery is exactly when things are broken).
 */
function handleClean(options: CleanCommandOptions): void {
  const config = loadTypecadConfig(process.cwd());
  if (!config) {
    throw new Error(
      "No typecad-hal.config.ts found in current directory.\n" +
      "Run 'typecad-hal create' to create one first.",
    );
  }
  if (!options.entry && !config.entry) {
    throw new Error(
      "typecad-hal.config.ts has no 'entry' field.\n" +
      "Add: entry: './src/main.ts' (or pass --entry <file>)",
    );
  }
  const entryPath = options.entry
    ? path.resolve(process.cwd(), options.entry)
    : path.resolve(path.dirname(config.configPath), config.entry!);

  const outcome = runClean({
    projectRoot: path.dirname(config.configPath),
    entryPath,
    ...(options.outDir ? { outDirOverride: options.outDir } : {}),
    ...(config.outputOutDir ? { configOutDir: config.outputOutDir } : {}),
    force: options.force,
  });

  const fmtBytes = (n: number): string =>
    n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

  if (outcome.removed.length > 0) {
    console.log(`${chalk.green("✓")} Removed generated output:`);
    for (const r of outcome.removed) {
      const rel = path.relative(process.cwd(), r.dir) || r.dir;
      console.log(`  ${rel} ${chalk.dim(`(reclaimed ${fmtBytes(r.bytes)})`)}`);
    }
    console.log(
      chalk.dim("  The next build regenerates everything — a first compile takes longer,"),
    );
    console.log(
      chalk.dim("  incremental caches were part of what was removed."),
    );
  }
  for (const dir of outcome.absent) {
    const rel = path.relative(process.cwd(), dir) || dir;
    console.log(`${chalk.dim(`• Nothing to clean at ${rel}.`)}`);
  }
  for (const dir of outcome.unmarked) {
    const rel = path.relative(process.cwd(), dir) || dir;
    console.log(`${chalk.yellow("!")} ${rel} exists but has no cuttlefish-generated marker —`);
    console.log(chalk.dim(`  pass --force to remove it anyway.`));
  }
  for (const r of outcome.refused) {
    const rel = path.relative(process.cwd(), r.dir) || r.dir;
    console.log(`${chalk.yellow("!")} Refusing to remove ${rel}: ${r.reason}.`);
  }
  if (outcome.refused.length > 0 || outcome.unmarked.length > 0) {
    process.exitCode = 1;
  }
}

/**
 * `typecad-hal debug-server <start|stop>` — drive the west-owned gdb server
 * for the last build (the F5 debug tasks call this; runnable directly for a
 * terminal-only session). Resolution mirrors build: the config's entry +
 * output.outDir locate the Zephyr app dir and its build.
 */
async function handleDebugServer(options: DebugServerCommandOptions): Promise<void> {
  const config = loadTypecadConfig(process.cwd());
  if (!config) {
    throw new Error(
      "No typecad-hal.config.ts found in current directory.\n" +
      "Run 'typecad-hal create' to create one first.",
    );
  }
  if (!config.entry) {
    throw new Error(
      "typecad-hal.config.ts has no 'entry' field.\n" +
      "Add: entry: './src/main.ts'",
    );
  }
  const entryFile = path.resolve(path.dirname(config.configPath), config.entry);
  const inputDir = path.dirname(entryFile);
  const outDir = config.outputOutDir
    ? path.resolve(inputDir, config.outputOutDir)
    : inputDir;

  // Standalone command — the framework is not loaded yet (the build flow
  // loads it). Load it from the config's framework field, same as doctor.
  if (!hasLoadedFramework() && config.framework) {
    try {
      loadFrameworkPackage(config.framework, process.cwd());
    } catch {
      // fall through to the delegation's no-toolchain error
    }
  }

  // --flash: the F5 preLaunchTask is ONE background task — run the full build
  // pipeline (transpile → compile → upload, with --debug) here, then serve.
  // (A dependsOn task chain + isBackground never releases the debug session —
  // VS Code awaits the whole dependency group, and the server never exits.)
  if (options.action === "start" && options.flash) {
    const platformContext: import("./api/shared/index.js").PlatformContext = config.buildTarget
      ? { frameworkData: { buildTarget: config.buildTarget } }
      : {};
    ui.printTranspiling();
    ui.printDebugStrategy(config.framework ?? "zephyr");
    const result = await transpileFile({
      inputFile: entryFile,
      emitMode: "split",
      target: "generic",
      outDir,
      emitMaps: true,
      platformContext,
      boardTarget: config.board,
      frameworkPackage: config.framework,
      debug: true,
      display: displayConfigForTranspile(config),
    });
    printDiagnostics(result.diagnostics);
    if (hasFatalDiagnostics(result)) {
      ui.printError("Transpilation failed. Fix the transpiler diagnostics above before compiling.");
      process.exitCode = 1;
      return;
    }
    const toolchainOpts = {
      outputDir: path.dirname(result.sourcePath),
      sourcePath: result.sourcePath,
      buildTarget: config.board ?? config.buildTarget,
      frameworkConfig: config?.frameworkConfig,
      zephyrConfig: config?.zephyrConfig,
      display: displayConfigForTranspile(config) as Record<string, unknown> | undefined,
      debug: true,
    };
    ui.printCompiling(toolchainOpts.buildTarget ?? "native");
    const compileResult = compileSource(toolchainOpts);
    if (!compileResult.success) {
      console.error(compileResult.output);
      process.exitCode = 1;
      return;
    }
    ui.printUploading(undefined);
    const uploadResult = uploadFirmware(toolchainOpts);
    if (uploadResult.output) console.log(uploadResult.output);
    if (!uploadResult.success) {
      process.exitCode = 1;
      return;
    }
  }

  debugServer(
    {
      outputDir: outDir,
      sourcePath: entryFile,
      // The runner resolution needs the same inputs the flash path gets:
      // the board target (board: / frameworkData.buildTarget in the config)
      // and the zephyr section (zephyr.probe + runnerArgs quirks).
      ...(config.board ? { buildTarget: config.board } : {}),
      ...(config.buildTarget ? { buildTarget: config.buildTarget } : {}),
      ...(config.zephyrConfig ? { zephyrConfig: config.zephyrConfig as Record<string, unknown> } : {}),
    },
    options.action,
  );
}

/**
 * Shared tail of `typecad-hal create`: list the created files, install the new
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

  // Framework starter debug profile: write .vscode/launch.json + tasks.json
  // so F5 in VS Code works before the first build. Runs after the install
  // step so the framework package resolves from the new project's
  // node_modules; best-effort — the first build upgrades the entry with the
  // build-resolved gdb path (runners.yaml).
  const debugArtifacts = generateFrameworkDebugArtifacts({
    frameworkPackage: result.options.frameworkPackage || undefined,
    workspaceRoot: result.outDir,
    buildTarget: result.options.buildTarget,
    // The scaffolded config's entry + outDir → the app dir the artifacts
    // must target (anything else assumes the default layout).
    appRel: starterAppRel(),
  });
  if (debugArtifacts.length > 0) {
    console.log(`\n${chalk.green("✓")} Debug profile: ${debugArtifacts.map((f) => chalk.white(f)).join(", ")}`);
  }

  printCreateNextSteps(result.options, result.outDir, { installed, debugProfile: debugArtifacts.length > 0 });
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

    if (options.command === "test") {
      // Forward to the test-runner CLI (dist/test-runner/cli.js) — it owns
      // the hardware-test flag surface. Same process-shape as the legacy
      // typecad-hal test bin, which remains registered as an alias.
      const exitCode = runTestRunner(options.forwarded);
      process.exit(exitCode);
    }

    if (options.command === "library") {
      await runLibraryCommand(options);
      return;
    }

    if (options.command === "clean") {
      handleClean(options);
      return;
    }

    if (options.command === "debug-server") {
      await handleDebugServer(options);
      return;
    }

    if (options.command === "preview") {
      await runPreviewServer({
        configPath: options.configPath,
        port: options.port ? Number(options.port) : undefined,
      });
      return;
    }

    if (options.command === "doctor" || options.command === "licenses") {
      // These commands run standalone (often before a build), so the framework
      // isn't loaded yet. Load it from the config's framework field so the
      // framework-supplied doctor/licenses handlers are available.
      if (!hasLoadedFramework()) {
        const config = loadTypecadConfig(process.cwd());
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

    // ── Handle board catalog sync / board module regen ────────────────────
    if (options.command === "board") {
      const config = loadTypecadConfig(process.cwd());
      if (!config) {
        throw new Error(
          "No typecad-hal.config.ts found in current directory.\n" +
          "Run 'typecad-hal create' to create one.",
        );
      }
      // The framework owns the board catalog + module generation; load it
      // the same way the doctor command does.
      if (!hasLoadedFramework() && config.framework) {
        try {
          loadFrameworkPackage(config.framework, process.cwd());
        } catch {
          // Framework package not resolvable — the hook error below names
          // the problem better than a loader crash would.
        }
      }
      const strategy = hasLoadedFramework()
        ? (getLoadedFramework().strategy as BoardCatalogStrategy)
        : undefined;

      if (options.subcommand === "sync") {
        if (typeof strategy?.syncBoardCatalog !== "function") {
          throw new Error(
            `Framework '${config.framework ?? "(none)"}' provides no board catalog sync — ` +
            `'typecad-hal board sync' applies to Zephyr-framework projects.`,
          );
        }
        const report = strategy.syncBoardCatalog(options.zephyrBase);
        const version = report.provenance.version || "unknown version";
        const head = report.provenance.gitHead ? ` @ ${report.provenance.gitHead.slice(0, 12)}` : "";
        const fp = sdkFingerprint(report.zephyrBase);
        ui.printSuccess(`Board catalog synced from Zephyr ${version}${head}`);
        console.log(chalk.gray(`  tree:     ${report.zephyrBase}`));
        if (fp) console.log(chalk.gray(`  fingerprint: ${fp} (pin ${PINNED_ZEPHYR_MANIFEST_REV})`));
        console.log(chalk.gray(`  catalog:  ${report.overlayPath}`));
        console.log(
          `  ${report.stats.variants} board variants (${report.stats.withFacts} with pin facts` +
          `${report.stats.failures > 0 ? `, ${report.stats.failures} reader failures` : ""}` +
          `${report.stats.droppedYamls > 0 ? `, ${report.stats.droppedYamls} yamls with no resolvable .dts` : ""})`,
        );
        const { added, changed, removed } = report;
        const list = (ids: readonly string[], verb: string): string =>
          ids.length === 0
            ? chalk.gray(`  0 ${verb}`)
            : `  ${ids.length} ${verb}: ${ids.slice(0, 8).join(", ")}${ids.length > 8 ? ", …" : ""}`;
        console.log(chalk.gray("  vs the previous catalog (what changed in your tree):"));
        console.log(list(added, "added"));
        console.log(list(changed, "changed"));
        console.log(list(removed, "removed"));
        // Refresh the project's own board module so the sync lands in this
        // project immediately (not just on the next first-build).
        if (config.board && !config.contract) {
          const dir = regenBoardModule(config);
          ui.printSuccess(
            `Regenerated the board module for '${config.board}' in ${path.join(dir, "board.ts")}`,
          );
        }
        return;
      }

      // regen: refresh a stale catalog overlay first, so a regen after
      // `west update` picks up the tree's boards automatically. Best-effort
      // — a missing tree or a failed walk must not block regenerating from
      // whatever catalog is already present.
      try {
        strategy?.ensureFreshBoardCatalog?.();
      } catch {
        // Non-fatal by design (see above).
      }
      const dir = regenBoardModule(config);
      ui.printSuccess(
        `Regenerated the board module for '${config.board}' in ${path.join(dir, "board.ts")}`,
      );
      return;
    }

    // ── Handle build command — entry point comes from config ──────────
    if (options.command === "build") {
      const buildConfig = loadTypecadConfig(process.cwd());
      if (!buildConfig) {
        throw new Error(
          "No typecad-hal.config.ts found in current directory.\n" +
          "Run 'typecad-hal create' to create one, or use: typecad-hal <input.ts> [options]",
        );
      }
      if (!buildConfig.entry) {
        throw new Error(
          "typecad-hal.config.ts has no 'entry' field.\n" +
          "Add: entry: './src/main.ts'",
        );
      }

      const entryFile = path.resolve(path.dirname(buildConfig.configPath), buildConfig.entry);
      if (!fs.existsSync(entryFile)) {
        throw new Error(`Entry file not found: ${entryFile}`);
      }

      assertTypeScriptInput(entryFile);
      (options as any).inputFile = entryFile;
      // The project root (directory holding typecad-hal.config.ts) is where the
      // ESLint gate looks for .typecad-hal/eslint.config.mjs. Threading it through
      // keeps the gate from silently no-op'ing when entry lives under src/.
      options.projectRoot = path.dirname(buildConfig.configPath);
      // Pass display config from typecad-hal.config.ts through to transpileFile
      if (buildConfig.display) {
        (options as any).display = displayConfigForTranspile(buildConfig);
      }
    }

    // gen-decls runs before the !options.inputFile guard below: in --all mode
    // it intentionally has no inputFile (it scans scanDir instead), so the
    // generic "Missing input file path" check would otherwise block it.
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
        const config = loadTypecadConfig(process.cwd());
        const exitCode = runExpectTests({
          port: options.port,
          buildTarget: config?.buildTarget,
          baud: options.baud,
          expectFile: options.expectFile,
        });
        process.exitCode = exitCode;
        return;
      }
      throw new Error("Missing input file path.");
    }

    assertTypeScriptInput(options.inputFile);

    // ── Load typecad-hal.config.ts (config wins over CLI flags) ──────────
    const inputDir = path.dirname(path.resolve(options.inputFile));
    const config = loadTypecadConfig(inputDir);

    // ── Contract-based board narrowing ──────────────────────────────────
    // If the config names a TypeCAD contract (*.contract.json from typecad.net),
    // generate the narrowed `.typecad-hal/board.ts` BEFORE env.d.ts is written
    // (it emits `export * from './board.js'` for this case) and before the
    // board package is resolved downstream. The generated board re-exports
    // only the pins/peripherals the PCB actually wires.
    if (config?.contract) {
      await generateContractBoard(config);
    }

    // Load the UI engine (if @typecad/ui is installed) before any UI work.
    await loadUIEngine();

    // Load the safety engine (if @typecad/safety is installed) before any
    // safety work.
    await loadSafetyEngine();

    let effectivePlatformContext = options.platformContext;
    let effectiveTarget = options.target;
    let effectiveOutDir = options.outDir;
    let effectiveBoardTarget = options.boardTarget;
    let effectiveFrameworkPackage = options.frameworkPackage;
    let effectivePort = options.port;
    // TYPECAD_HAL_PORT env var sits between the CLI flag and the config file
    // (flag > env > config), so cross-platform uploads don't need a
    // Windows-specific COM port baked into package.json scripts.
    if (!effectivePort && process.env.TYPECAD_HAL_PORT) {
      effectivePort = process.env.TYPECAD_HAL_PORT;
    }

    if (config) {
      if (config.board) {
        effectiveBoardTarget = config.board;
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
            // PSRAM-enabling Kconfig + BOARD_HAS_PSRAM compile definition.
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

      // Keep typecad-hal-env.d.ts in sync (global type declarations; the
      // virtual hardware specifiers resolve through tsconfig paths, not
      // ambient declarations). Platform-specific declarations come from the
      // strategy if available.
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
      board: effectiveBoardTarget,
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
          boardTarget: effectiveBoardTarget,
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
            
            const watchOpts = {
              outputDir: path.dirname(result.sourcePath),
              sourcePath: result.sourcePath,
              buildTarget: baseBuildTarget,
              port: effectivePort,
              baud: options.baud,
              extraFlags: config?.outputExtraFlags,
              defines: config?.outputDefines ?? {},
              psram: config?.psram,
              frameworkConfig: config?.frameworkConfig,
              zephyrConfig: config?.zephyrConfig,
              display: displayConfigForTranspile(config) as Record<string, unknown> | undefined,
              debug: options.debug,
            };
            ui.printCompiling(baseBuildTarget ?? "native");
            const compileResult = compileSource(watchOpts);
            printMappedCompileErrors(compileResult, result.sourceMapPath, result.sourcePath, path.dirname(result.sourcePath));

            if (compileResult.success) {
              if (compileResult.memoryUsage) ui.printMemoryUsage(compileResult.memoryUsage);
              
              if (options.upload) {
                // No port gate here — probe/USB flashing needs none, and the
                // framework reports a friendly failure when the runner does.
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
          console.log(chalk.cyan(`⤳ Cuttlefish`) + chalk.gray(` v${ui.VERSION}`));
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
              boardTarget: effectiveBoardTarget,
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
                
                const rebuildOpts = {
                  outputDir: path.dirname(rebuildResult.sourcePath),
                  sourcePath: rebuildResult.sourcePath,
                  buildTarget: baseBuildTarget,
                  port: effectivePort,
                  baud: options.baud,
                  extraFlags: config?.outputExtraFlags,
                  defines: config?.outputDefines ?? {},
                  psram: config?.psram,
                  frameworkConfig: config?.frameworkConfig,
                  zephyrConfig: config?.zephyrConfig,
              display: displayConfigForTranspile(config) as Record<string, unknown> | undefined,
                  debug: options.debug,
                };
                ui.printCompiling(baseBuildTarget ?? "native");
                const compileResult = compileSource(rebuildOpts);
                printMappedCompileErrors(compileResult, rebuildResult.sourceMapPath, rebuildResult.sourcePath, path.dirname(rebuildResult.sourcePath));

                if (compileResult.success) {
                  if (compileResult.memoryUsage) ui.printMemoryUsage(compileResult.memoryUsage);

                  if (options.upload) {
                    // No port gate here — probe/USB flashing needs none, and
                    // the framework reports a friendly failure when the
                    // runner does.
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
        boardTarget: effectiveBoardTarget,
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
          baud: options.baud,
          expectFile: options.expectFile,
        });
        process.exitCode = exitCode;
      }
      return;
    }

    // --compile (delegates to the active framework's toolchain)
    const baseBuildTarget = (effectivePlatformContext?.frameworkData?.buildTarget as string | undefined) ?? (options.platformContext?.frameworkData?.buildTarget as string | undefined);

    const toolchainOpts = {
      outputDir: path.dirname(result.sourcePath),
      sourcePath: result.sourcePath,
      buildTarget: baseBuildTarget,
      port: effectivePort,
      baud: options.baud,
      extraFlags: config?.outputExtraFlags,
      defines: config?.outputDefines ?? {},
      psram: config?.psram,
      frameworkConfig: config?.frameworkConfig,
      // --probe <method> overrides zephyr.probe from the config for this run.
      zephyrConfig: options.probe
        ? { ...(config?.zephyrConfig ?? {}), probe: options.probe }
        : config?.zephyrConfig,
              display: displayConfigForTranspile(config) as Record<string, unknown> | undefined,
      debug: options.debug,
    };

    ui.printCompiling(baseBuildTarget ?? "native");
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

    // --upload. Whether a port is required is the active framework's call —
    // probe-based flashing (openocd/jlink) and USB bootloaders (dfu-util,
    // uf2) need no serial port, so a missing --port only surfaces as the
    // framework's own upload failure for serial-port runners (esptool,
    // bossac).
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
      // --monitor (blocks until Ctrl+C). Unlike flashing, monitoring always
      // needs a serial port — there is no probe/USB flavor of it.
      if (!port) {
        throw new Error("--monitor requires a port. Set --port <port> on the command line (or the TYPECAD_HAL_PORT env var).");
      }
      // Show the resolved --baud in the banner — toolchainOpts.baud is built
      // the same way, so what the user sees is what the framework monitor
      // opens the port at.
      ui.printMonitoring(port, toolchainOpts.baud ?? 115200);
      monitorDevice(toolchainOpts);
      return;
    }

    // --expect: Run hardware tests after upload
    if (options.expect) {
      ui.printSuccess();
      const exitCode = runExpectTests({
        port: effectivePort,
        buildTarget: baseBuildTarget,
        baud: options.baud,
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
