import path from "node:path";
import { CommandLineOptions, CreateCommandOptions, LibraryCommandOptions, BoardCommandOptions, CleanCommandOptions, DebugServerCommandOptions, TestCommandOptions, EmitMode, PlatformContext, TargetProfile, TreeShakingOptions } from "../types.js";

import chalk from "chalk";

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"),
        "utf8",
      ),
    ).version as string;
  } catch {
    return "0.0.0";
  }
})();
const ICON = "⤳";

export function printHelp(): void {
  console.log();
  console.log(chalk.cyan(`${ICON} typecad-hal`) + chalk.gray(` v${VERSION}`));
  console.log(chalk.gray(`  TypeScript to C++ transpiler`));
  console.log();
  console.log(chalk.cyan(`USAGE`));
  console.log();
  console.log(`  typecad-hal <input.ts> [options]`);
  console.log(`  typecad-hal create [name] [options]`);
  console.log(`  typecad-hal build [options]`);
  console.log(`  typecad-hal test [files...] [options]            Run hardware tests (flash tests/ + report over serial)`);
  console.log(`  typecad-hal preview [--config <path>] [--port <port>]`);
  console.log(`  typecad-hal gen-decls <input.cpp|--all <directory>>`);
  console.log(`  typecad-hal board sync [zephyr-base]            Rebuild the board catalog from your Zephyr tree (after west update)`);
  console.log(`  typecad-hal board regen                          Regenerate the project-local board module (.typecad-hal/board.ts + board.json)`);
  console.log(`  typecad-hal doctor                              Check the active framework's environment (e.g. toolchain + board core)`);
  console.log(`  typecad-hal licenses [--all] [--strict]          Scan this project's libraries for SPDX licenses (--all: every installed library)`);
  console.log();
  console.log(chalk.cyan(`LIBRARY PACKAGES`) + chalk.gray(` (npm keywords are the catalog)`));
  console.log();
  console.log(`  typecad-hal library search [text] [--category <id>] [--json]`);
  console.log(`                          Browse typecad-hal library packages on npm, optionally by category`);
  console.log(`  typecad-hal library install <pkg...>             Install library packages into this project`);
  console.log(`  typecad-hal library init [name] [--framework <id>] [--category <id>] [--targets <list>]`);
  console.log(`                          Scaffold a new library package (interactive; --yes takes defaults)`);
  console.log(`  typecad-hal library validate [path] [--json]     Validate a library package (manifest, shims, keywords, AUTOSAR strict)`);
  console.log();
  console.log(chalk.gray(`Transpilation is always performed first. Use --compile, --upload, and`));
  console.log(chalk.gray(`--monitor to chain operations after transpilation.`));
  console.log();
  console.log(chalk.cyan(`OPTIONS`));
  console.log();
  console.log(`  --emit <mode>           Emit mode: "cpp" or "split" (default: split)`);
  console.log(`                          - cpp: single output file`);
  console.log(`                          - split: separate .cpp and .h files`);
  console.log(`                          Note: Output file extension is determined by the framework strategy`);
  console.log();
  console.log(`  --target <platform>     Target platform string (default: generic).`);
  console.log(`                          The loaded framework package registers its own target id.`);
  console.log();
  console.log(`  --outDir, --out-dir <path>`);
  console.log(`                          Output directory for generated files (default: input file directory)`);
  console.log();
  console.log(`  --emit-maps <bool>      Emit source maps: "true" or "false" (default: true)`);
  console.log(`                          Source maps enable mapping C++ errors back to TypeScript`);
  console.log();
  console.log(`  --autosar[=<mode>]      AUTOSAR C++14 compliance mode for emitted code:`);
  console.log(`                            off     no enforcement (default)`);
  console.log(`                            warn    emit AUTOSAR_* diagnostics + sidecar, build still succeeds`);
  console.log(`                            strict  abort emit on unrecorded required violations`);
  console.log(`                          A sidecar <name>.autosar-deviations.json is written next to the`);
  console.log(`                          emitted artifact in warn/strict modes.`);
  console.log();
  console.log(`  --autosar-arxml         Also write <name>.autosar-deviations.arxml (Artop/DaVinci).`);
  console.log(`                          No-op unless --autosar is warn or strict.`);
  console.log();
  console.log(`  --strict-css            Treat UI CSS-compatibility warnings as errors (css-*`);
  console.log(`                          diagnostics: ignored alpha, quantized font sizes,`);
  console.log(`                          unsupported display/position values, viewport-hogging sizes).`);
  console.log();
  console.log(chalk.cyan(`BUILD COMMANDS`) + chalk.gray(` (chain in order: --compile → --upload → --monitor)`));
  console.log();
  console.log(`  --compile               Compile the generated output using the framework toolchain.`);
  console.log(`                          Requires a build target (e.g. via --build-target or config).`);
  console.log();
  console.log(`  --upload                Upload the compiled firmware to the board.`);
  console.log(`                          Requires: --compile, --port (if applicable to framework).`);
  console.log();
  console.log(`  --monitor               Open an interactive serial monitor after upload.`);
  console.log(`                          Requires: --port (if applicable to framework).`);
  console.log();
  console.log(chalk.cyan(`TESTING`));
  console.log();
  console.log(`  --expect [file]         Run hardware tests via the built-in test-runner (typecad-hal test).`);
  console.log(`                          Optionally specify a test file to run a single test.`);
  console.log(`                          Discovers test files and validates via serial.`);
  console.log();
  console.log(`  --build-target <id>     Framework-specific build target identifier.`);
  console.log(`                          Required by most frameworks for --compile and --upload.`);
  console.log(`                          Example: blackpill_f411ce/stm32f411xe, esp32s3_devkitc/esp32s3/procpu`);
  console.log();
  console.log(`  --port <port>           Serial port of the connected board.`);
  console.log(`                          Required for --upload and --monitor.`);
  console.log(`                          Example: COM4, /dev/ttyACM0`);
  console.log();
  console.log(`  --baud <rate>           Baud rate for --monitor (default: 9600)`);
  console.log();
  console.log(`  --framework <pkg>       Framework package for code generation strategy.`);
  console.log(`                          Overrides typecad-hal.config.ts framework setting.`);
  console.log(`                          Example: @typecad/framework-zephyr, @typecad/framework-native`);
  console.log();
  console.log(chalk.cyan(`BUILD COMMAND`));
  console.log();
  console.log(`  build                    Build using entry point from typecad-hal.config.ts`);
  console.log(`                           Requires 'entry' field in config file.`);
  console.log(`                           Supports all transpile, compile, upload, and watch options.`);
  console.log();
  console.log(`  clean                    Remove the generated output dir (resolved from the config's`);
  console.log(`                           output.outDir, like build). Escape hatch for a wedged build`);
  console.log(`                           dir or orphaned output; the next build regenerates it all.`);
  console.log(`                           --force removes a dir lacking the generated marker.`);
  console.log();
  console.log(`  debug-server <start|stop>`);
  console.log(`                           Start/stop the west-owned gdb server (west debugserver)`);
  console.log(`                           the F5 debug session connects to. Managed by the debug`);
  console.log(`                           tasks; run directly for a terminal-only gdb session.`);
  console.log();
  console.log(`  preview                  Start a browser preview for the configured UI display.`);
  console.log(`                           Uses typecad-hal.config.ts by default.`);
  console.log();
  console.log(chalk.cyan(`WATCH MODE`));
  console.log();
  console.log(`  --watch, -w             Watch for file changes and retranspile automatically.`);
  console.log(`                          Monitors the entry file and all imports for changes.`);
  console.log(`                          Works with --compile and --upload.`);
  console.log(`                          Incompatible with --monitor.`);
  console.log();
  console.log(chalk.cyan(`TREE-SHAKING OPTIONS`));
  console.log();
  console.log(`  --no-tree-shake          Disable tree-shaking (dead code elimination)`);
  console.log();
  console.log(`  --keep-unused-enums      Keep all enums even if not referenced`);
  console.log();
  console.log(`  --keep-unused-classes    Keep all classes even if not instantiated`);
  console.log();
  console.log(`  --keep-unused-types      Keep all type aliases even if not used`);
  console.log();
  console.log(`  --keep-unused-variables   Keep all top-level variables even if not referenced`);
  console.log();
  console.log(`  --entry-point <name>     Add a custom entry point symbol (repeatable)`);
  console.log(`                           Default entry points determined by the framework strategy.`);
  console.log();
  console.log(`  --diagnostics           Generate diagnostics.md and diagnostics.json reports`);
  console.log(`                          Includes IR graph, heap analysis, and task analysis`);
  console.log();
  console.log(`  --debug                 Inject Serial.println instrumentation at breakpoints.`);
  console.log(`                          Reads .typecad-hal/breakpoints.json (written by the`);
  console.log(`                          TypeCAD Debug VS Code extension). At each breakpoint the`);
  console.log(`                          firmware prints the location, original line, and in-scope`);
  console.log(`                          variables, then halts — press ENTER over serial to continue.`);
  console.log();
  console.log(`  --help, -h              Show this help message`);
  console.log();
  console.log(chalk.cyan(`PROJECT CREATION`));
  console.log();
  console.log(`  create [name]           Create a new TypeCAD project`);
  console.log(`                          Interactive wizard (also with --board on a terminal;`);
  console.log(`                          piped/CI runs are non-interactive).`);
  console.log();
  console.log(`  --target, -t <id>       Target platform (native, or any catalog board)`);
  console.log();
  console.log(`  --board, -b <id>        Alias for --target`);
  console.log();
  console.log(`  --framework, -f <pkg>   Framework (zephyr, native)`);
  console.log();
  console.log(`  --probe, --flash <id>   Probe/flash method (stlink, dfu, jlink, ...) —`);
  console.log(`                          what uploads AND debugs the board`);
  console.log();
  console.log(`  --port, -p <port>       Serial port the board is on (COM10, /dev/ttyACM0)`);
  console.log();
  console.log(`  --baud <rate>           Serial baud rate (default: 115200 on Zephyr, 9600 otherwise)`);
  console.log();
  console.log(`  --no-starter            Skip generating the starter program`);
  console.log();
  console.log(`  --outDir, -o <path>     Output directory (default: ./<name>)`);
  console.log();
  console.log(chalk.cyan(`EXAMPLES`));
  console.log();
  console.log(chalk.gray(`  # Interactive project setup`));
  console.log(`  typecad-hal create`);
  console.log();
  console.log(chalk.gray(`  # Native desktop project`));
  console.log(`  typecad-hal create my-app --target native`);
  console.log();
  console.log(chalk.gray(`  # Zephyr board project`));
  console.log(`  typecad-hal create my-project --target blackpill-f411ce`);
  console.log();
  console.log(chalk.gray(`  # Custom STM32F411 hardware — generated Zephyr board`));
  console.log();
  console.log(chalk.gray(`  # Build using config entry point`));
  console.log(`  typecad-hal build --compile --upload --port COM4`);
  console.log();
  console.log(chalk.gray(`  # Build in watch mode`));
  console.log(`  typecad-hal build --watch`);
  console.log();
  console.log(chalk.gray(`  # Transpile to generic C++`));
  console.log(`  typecad-hal src/main.ts`);
  console.log();
  console.log(chalk.gray(`  # Transpile using the Zephyr framework`));
  console.log(`  typecad-hal main.ts --framework @typecad/framework-zephyr --outDir ./build`);
  console.log();
  console.log(chalk.gray(`  # Transpile and compile for the Black Pill`));
  console.log(`  typecad-hal main.ts --framework @typecad/framework-zephyr --compile --build-target blackpill_f411ce/stm32f411xe`);
  console.log();
  console.log(chalk.gray(`  # Transpile, compile, and upload`));
  console.log(`  typecad-hal main.ts --framework @typecad/framework-zephyr --compile --upload --build-target blackpill_f411ce/stm32f411xe --port COM4`);
  console.log();
  console.log(chalk.gray(`  # Full chain: transpile → compile → upload → monitor`));
  console.log(`  typecad-hal main.ts --framework @typecad/framework-zephyr --compile --upload --monitor --build-target blackpill_f411ce/stm32f411xe --port COM4 --baud 115200`);
  console.log();
  console.log(chalk.gray(`  # Watch mode: auto-retranspile on changes`));
  console.log(`  typecad-hal main.ts --watch`);
  console.log();
  console.log(chalk.gray(`  # Watch and auto-compile`));
  console.log(`  typecad-hal main.ts --framework @typecad/framework-zephyr --watch --compile --build-target blackpill_f411ce/stm32f411xe`);
  console.log();
}

function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1 || index === argv.length - 1) {
    return undefined;
  }
  return argv[index + 1];
}

function readFirstFlagValue(argv: string[], flags: string[]): string | undefined {
  for (const flag of flags) {
    const value = readFlag(argv, flag);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function readBooleanFlag(argv: string[], flags: string[]): boolean {
  return flags.some(flag => argv.includes(flag));
}

function readNumberFlag(argv: string[], flags: string[], defaultValue?: number): number | undefined {
  const rawValue = readFirstFlagValue(argv, flags);
  if (rawValue === undefined) {
    return defaultValue;
  }
  const parsed = Number(rawValue);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function readRepeatedFlag(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
      values.push(argv[i + 1]);
    }
  }
  return values;
}

function parsePipelineCommand(
  argv: string[],
  command: "build" | "default",
  inputFile?: string,
): CommandLineOptions {
  const emitFlag = readFirstFlagValue(argv, ["--emit"]);
  const targetFlag = readFirstFlagValue(argv, ["--target"]);
  const outDir = readFirstFlagValue(argv, ["--outDir", "--out-dir"]);
  const emitMapsFlag = readFirstFlagValue(argv, ["--emit-maps"]);
  const buildTarget = readFirstFlagValue(argv, ["--build-target"]);
  const port = readFirstFlagValue(argv, ["--port"]);
  const probeFlag = readFirstFlagValue(argv, ["--probe", "--flash"]);
  // Default to undefined (NOT a hardcoded baud) so the build/upload/monitor
  // flow falls through to the framework's monitor default when --baud is
  // absent. Hardcoding 9600 here forced the monitor to open the port at 9600
  // and ignore --baud given elsewhere.
  const baud = readNumberFlag(argv, ["--baud"]);
  const frameworkFlag = readFirstFlagValue(argv, ["--framework"]);

  const compile = readBooleanFlag(argv, ["--compile"]);
  const upload = readBooleanFlag(argv, ["--upload"]);
  const monitor = readBooleanFlag(argv, ["--monitor"]);
  const watch = readBooleanFlag(argv, ["--watch"]) || argv.includes("-w");
  const debug = readBooleanFlag(argv, ["--debug"]);
  const noTranspile = readBooleanFlag(argv, ["--no-transpile"]);
  const force = readBooleanFlag(argv, ["--force"]);
  const skipTypeCheck = readBooleanFlag(argv, ["--skip-type-check"]);
  const diagnostics = readBooleanFlag(argv, ["--diagnostics"]);
  const expect = readBooleanFlag(argv, ["--expect"]);
  const expectArg = readFlag(argv, "--expect");
  const expectFile = expect && expectArg && !expectArg.startsWith("-") ? expectArg : undefined;

  const noTreeShake = readBooleanFlag(argv, ["--no-tree-shake"]);
  const keepUnusedEnums = readBooleanFlag(argv, ["--keep-unused-enums"]);
  const keepUnusedClasses = readBooleanFlag(argv, ["--keep-unused-classes"]);
  const keepUnusedTypes = readBooleanFlag(argv, ["--keep-unused-types"]);
  const keepUnusedVariables = readBooleanFlag(argv, ["--keep-unused-variables"]);
  const entryPoints = readRepeatedFlag(argv, "--entry-point");

  // AUTOSAR C++14 compliance mode for emitted code. Accepts both
  // `--autosar=strict` (= syntax) and `--autosar strict` (space syntax),
  // plus the bare `--autosar` (treated as "strict"). Defaults to undefined,
  // which the emitter treats as "off".
  let autosar: "off" | "warn" | "strict" | undefined;
  const autosarFlagIdx = argv.findIndex((a) => a === "--autosar" || a.startsWith("--autosar="));
  if (autosarFlagIdx !== -1) {
    const raw = argv[autosarFlagIdx];
    if (raw === "--autosar") {
      // Bare flag → strict. (No following value consumed.)
      autosar = "strict";
    } else {
      // --autosar=<mode>
      const value = raw.slice("--autosar=".length);
      if (value === "strict" || value === "warn" || value === "off") {
        autosar = value;
      } else {
        throw new Error(`--autosar must be one of: strict, warn, off (got: ${value})`);
      }
    }
  }

  // --autosar-arxml: also write the .autosar-deviations.arxml sidecar
  // (Artop/DaVinci tooling). No-op unless --autosar is warn or strict.
  const autosarArxml = readBooleanFlag(argv, ["--autosar-arxml"]);

  // --strict-css: upgrade UI CSS-compatibility warnings (css-* diagnostics,
  // e.g. ignored alpha, quantized font sizes, unsupported display values) to
  // errors so builds fail instead of silently approximating.
  const strictCss = readBooleanFlag(argv, ["--strict-css"]);

  const emitMode: EmitMode = emitFlag === "cpp" || emitFlag === "split" ? emitFlag : "split";
  const emitMaps = emitMapsFlag === undefined ? true : emitMapsFlag !== "false";
  // Accept any target string — the framework package registers its own strategy id.
  // Fall back to "generic" (GenericStrategy) when not specified.
  const target: TargetProfile = targetFlag ?? "generic";

  const platformContext: PlatformContext = {
    architecture: buildTarget?.split(":")?.[1]?.toLowerCase(),
    frameworkData: { buildTarget },
  };

  if (upload && !compile) {
    throw new Error("--upload requires --compile.");
  }
  // Note: port validation is deferred to the build path, which checks the
  // effective port (CLI --port flag OR the TYPECAD_HAL_PORT env var). This
  // allows setting the port in the environment instead of on every command.
  if (watch && monitor) {
    throw new Error("--watch and --monitor cannot be used together (monitor blocks the process).");
  }

  const treeShaking: TreeShakingOptions = {
    enabled: !noTreeShake,
    keepUnusedEnums,
    keepUnusedClasses,
    keepUnusedTypeAliases: keepUnusedTypes,
    keepUnusedVariables,
    reportUnused: false,
    entryPoints: entryPoints.length > 0 ? entryPoints : undefined,
  };

  return {
    command,
    inputFile: inputFile ? path.resolve(process.cwd(), inputFile) : undefined,
    emitMode,
    target,
    outDir: outDir ? path.resolve(process.cwd(), outDir) : undefined,
    emitMaps,
    noTranspile: command === "default" ? noTranspile : false,
    compile,
    upload,
    monitor,
    watch,
    port,
    probe: probeFlag,
    baud,
    platformContext,
    treeShaking,
    debug,
    force,
    skipTypeCheck,
    diagnostics,
    expect,
    expectFile,
    frameworkPackage: frameworkFlag,
    autosar,
    autosarArxml,
    strictCss,
  };
}

export function parseCommandLine(argv: string[]): CommandLineOptions | CreateCommandOptions | LibraryCommandOptions | BoardCommandOptions | CleanCommandOptions | DebugServerCommandOptions | TestCommandOptions | "help" {
  const firstArg = argv[2];

  if (!firstArg || firstArg === "--help" || firstArg === "-h") {
    return "help";
  }

  // create subcommand — project scaffolding
  if (firstArg === "create") {
    const secondArg = argv[3];
    const projectName = secondArg && !secondArg.startsWith("-") ? secondArg : undefined;

    const target = readFirstFlagValue(argv, ["--target", "-t"])
      ?? readFirstFlagValue(argv, ["--board", "-b"]);
    const framework = readFirstFlagValue(argv, ["--framework", "-f"]);
    const baudRaw = readFirstFlagValue(argv, ["--baud"]);
    const outDir = readFirstFlagValue(argv, ["--outDir", "--out-dir", "-o"]);
    const noStarter = argv.includes("--no-starter");
    const noInstall = argv.includes("--no-install");
    const probeFlag = readFirstFlagValue(argv, ["--probe", "--flash"]);
    const portFlag = readFirstFlagValue(argv, ["--port", "-p"]);

    const baud = baudRaw && !Number.isNaN(Number(baudRaw)) ? Number(baudRaw) : undefined;

    return {
      command: "create",
      probe: probeFlag,
      projectName,
      target,
      baud,
      framework,
      noStarter,
      noInstall,
      port: portFlag,
      outDir: outDir ? path.resolve(process.cwd(), outDir) : undefined,
    };
  }

  // build subcommand — entry point comes from typecad-hal.config.ts
  if (firstArg === "build") {
    return parsePipelineCommand(argv, "build");
  }

  // test subcommand — run hardware tests. Everything after 'test' is
  // forwarded verbatim to the test-runner CLI (dist/test-runner/cli.js),
  // which owns the flag surface (--config, --port, --include, ...).
  if (firstArg === "test") {
    return { command: "test", forwarded: argv.slice(3) };
  }

  // clean subcommand — remove the resolved generated output dir (escape
  // hatch for a wedged build dir / orphaned output; everything in it is
  // regenerated by the next build).
  if (firstArg === "clean") {
    const outDir = readFirstFlagValue(argv, ["--outDir", "--out-dir"]);
    const entry = readFirstFlagValue(argv, ["--entry", "-e"]);
    return {
      command: "clean",
      outDir: outDir ? path.resolve(process.cwd(), outDir) : undefined,
      entry: entry ? path.resolve(process.cwd(), entry) : undefined,
      force: argv.includes("--force"),
    };
  }

  // debug-server subcommand — start/stop the west-owned gdb server the F5
  // debug session connects to (cortex-debug external-server mode).
  if (firstArg === "debug-server") {
    const action = argv[3] === "stop" ? "stop" : argv[3] === "start" ? "start" : undefined;
    if (!action) {
      throw new Error("Usage: typecad-hal debug-server <start|stop>");
    }
    return { command: "debug-server", action, flash: argv.includes("--flash") };
  }

  if (firstArg === "preview") {
    const configPath = readFirstFlagValue(argv, ["--config"]);
    const port = readNumberFlag(argv, ["--port"]);
    return {
      command: "preview",
      inputFile: undefined,
      emitMode: "split",
      target: "generic",
      emitMaps: true,
      noTranspile: false,
      compile: false,
      upload: false,
      monitor: false,
      watch: false,
      baud: 9600,
      platformContext: {},
      configPath: configPath ? path.resolve(process.cwd(), configPath) : undefined,
    port: port ? String(port) : undefined,
  };
  }

  // doctor subcommand — verify the active framework's environment
  if (firstArg === "doctor") {
    return {
      command: "doctor",
      // The remaining pipeline fields are unused by doctor; fill with safe
      // defaults, the same way the preview branch does.
      inputFile: undefined,
      emitMode: "split",
      target: "generic",
      outDir: undefined,
      emitMaps: true,
      noTranspile: false,
      compile: false,
      upload: false,
      monitor: false,
      watch: false,
      baud: 9600,
      platformContext: {},
    };
  }

  // licenses subcommand — scan the project's dependencies for SPDX licenses.
  // Accept `license` (singular) as an alias so both spellings work.
  if (firstArg === "licenses" || firstArg === "license") {
    return {
      command: "licenses",
      strict: argv.includes("--strict"),
      all: argv.includes("--all"),
      // The remaining pipeline fields are unused by licenses; fill with safe
      // defaults, the same way the doctor branch does.
      inputFile: undefined,
      emitMode: "split",
      target: "generic",
      outDir: undefined,
      emitMaps: true,
      noTranspile: false,
      compile: false,
      upload: false,
      monitor: false,
      watch: false,
      baud: 9600,
      platformContext: {},
    };
  }

  // board subcommand — project-local board module management
  // (sync: rebuild the board catalog overlay from the user's Zephyr tree —
  // the refresh path after `west update`; regen: re-emit
  // .typecad-hal/board.ts + board.json from the active catalog).
  if (firstArg === "board") {
    const sub = argv[3];
    if (sub === "sync") {
      // Optional positional: an explicit Zephyr checkout to sync from.
      const positional = argv.slice(4).find((a) => !a.startsWith("-"));
      return { command: "board", subcommand: "sync", zephyrBase: positional };
    }
    if (sub !== "regen") {
      throw new Error(
        "Usage: typecad-hal board <sync|regen> — 'sync' rebuilds the board catalog from your " +
          "Zephyr tree, 'regen' regenerates .typecad-hal/board.ts + board.json for the config's " +
          "board target.",
      );
    }
    return { command: "board", subcommand: "regen" };
  }

  // library subcommand — the library package manager
  // (search/install/init/validate; npm keywords are the catalog).
  if (firstArg === "library") {
    const sub = argv[3];
    const known = new Set(["search", "install", "init", "validate"]);
    if (!sub || !known.has(sub)) {
      throw new Error(
        "Usage: typecad-hal library <search|install|init|validate> [args]. " +
          "Try 'typecad-hal library search' to browse, or 'typecad-hal library init <name>'.",
      );
    }
    const subcommand = sub as "search" | "install" | "init" | "validate";

    // Value flags accept both forms (--category led and --category=led); the
    // generic readFlag helper only handles the space-separated form, which
    // would silently drop an equals-form filter.
    const valueFlags = new Set(["--category", "--framework", "--targets", "--dir"]);
    const flagValues = new Map<string, string>();
    const positionals: string[] = [];
    let jsonFlag = false;
    let yesFlag = false;
    for (let i = 4; i < argv.length; i++) {
      const tok = argv[i];
      if (tok.startsWith("--") && tok.includes("=")) {
        const eq = tok.indexOf("=");
        flagValues.set(tok.slice(0, eq), tok.slice(eq + 1));
        continue;
      }
      if (valueFlags.has(tok)) {
        if (i + 1 < argv.length) {
          flagValues.set(tok, argv[++i]);
        }
        continue;
      }
      if (tok === "--json") {
        jsonFlag = true;
        continue;
      }
      if (tok === "--yes" || tok === "-y") {
        yesFlag = true;
        continue;
      }
      if (tok.startsWith("-")) continue;
      positionals.push(tok);
    }

    const category = flagValues.get("--category");
    if (category !== undefined && subcommand !== "search" && subcommand !== "init") {
      throw new Error("--category applies to 'library search' and 'library init' only.");
    }

    return {
      command: "library",
      subcommand,
      positionals,
      category,
      framework: flagValues.get("--framework"),
      targets: flagValues.get("--targets"),
      dir: flagValues.get("--dir"),
      yes: yesFlag,
      json: jsonFlag,
    };
  }

  // gen-decls subcommand — generate .d.ts from C++ files
  if (firstArg === "gen-decls") {
    const emitFlag = readFirstFlagValue(argv, ["--emit"]);
    const targetFlag = readFirstFlagValue(argv, ["--target"]);
    const outDir = readFirstFlagValue(argv, ["--outDir", "--out-dir"]);
    const emitMapsFlag = readFirstFlagValue(argv, ["--emit-maps"]);
    const buildTarget = readFirstFlagValue(argv, ["--build-target"]);

    const emitMode: EmitMode = emitFlag === "cpp" || emitFlag === "split" ? emitFlag : "split";
    const target: TargetProfile = targetFlag ?? "generic";
    const emitMaps = emitMapsFlag === undefined ? true : emitMapsFlag !== "false";
    const platformContext: PlatformContext = {
      architecture: buildTarget?.split(":")?.[1]?.toLowerCase(),
      frameworkData: { buildTarget },
    };

    const allFlag = argv.includes("--all");

    // The positional path may sit at argv[3] or argv[4] depending on whether
    // --all precedes or follows it. Scan argv starting after the subcommand
    // name (argv[2]) for the first token that is not a flag and not a known
    // flag's value. This mirrors the default-pipeline approach of "first
    // non-flag token wins".
    const valueFlags = new Set([
      "--emit", "--target", "--outDir", "--out-dir", "--emit-maps", "--build-target",
    ]);
    let inputPath: string | undefined;
    for (let i = 3; i < argv.length; i++) {
      const tok = argv[i];
      if (valueFlags.has(tok)) {
        // Value-consuming flag: skip its value (if any) so it isn't mistaken
        // for the positional path.
        if (i + 1 < argv.length) { i++; }
        continue;
      }
      if (tok.startsWith("-")) {
        continue; // boolean flag (e.g. --all) or unknown flag — ignore
      }
      inputPath = tok;
      break;
    }

    if (!inputPath && !allFlag) {
      throw new Error("Missing input C++ file path. Use: gen-decls <file.cpp> or gen-decls --all <directory>");
    }

    const scanDir = allFlag ? (inputPath || process.cwd()) : undefined;
    const inputFile = allFlag ? undefined : inputPath;

    return {
      command: "gen-decls",
      inputFile: inputFile ? path.resolve(process.cwd(), inputFile) : undefined,
      emitMode,
      target,
      outDir: outDir ? path.resolve(process.cwd(), outDir) : undefined,
      emitMaps,
      noTranspile: false,
      compile: false,
      upload: false,
      monitor: false,
      watch: false,
      baud: 9600,
      platformContext,
      scanDir: scanDir ? path.resolve(process.cwd(), scanDir) : undefined,
    } as CommandLineOptions;
  }

  // Default: firstArg is the input file (unless it's a flag like --expect)
  const inputFile = firstArg.startsWith("-") ? undefined : firstArg;
  return parsePipelineCommand(argv, "default", inputFile);
}
