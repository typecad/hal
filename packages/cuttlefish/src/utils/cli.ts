import path from "node:path";
import { CommandLineOptions, CreateCommandOptions, BoardAddCommandOptions, EmitMode, PlatformContext, TargetProfile, TreeShakingOptions } from "../types.js";

import chalk from "chalk";

const VERSION = "0.1.0";
const ICON_CUTTLEFISH = "⤳";

export function printHelp(): void {
  console.log();
  console.log(chalk.cyan(`${ICON_CUTTLEFISH} Cuttlefish`) + chalk.gray(` v${VERSION}`));
  console.log(chalk.gray(`  TypeScript to C++ transpiler`));
  console.log();
  console.log(chalk.cyan(`USAGE`));
  console.log();
  console.log(`  cuttlefish <input.ts> [options]`);
  console.log(`  cuttlefish create [name] [options]`);
  console.log(`  cuttlefish build [options]`);
  console.log(`  cuttlefish preview [--config <path>] [--port <port>]`);
  console.log(`  cuttlefish gen-libdefs <input.ts>`);
  console.log(`  cuttlefish board add <spec.jsonc> [--force]   Generate board + MCU packages from a chip spec`);
  console.log(`  cuttlefish gen-decls <input.cpp|--all <directory>>`);
  console.log(`  cuttlefish map-error <mapFile> [options]`);
  console.log(`  cuttlefish doctor                              Check that arduino-cli is installed and the board's core is present`);
  console.log(`  cuttlefish licenses [--all] [--strict]          Scan this project's Arduino libraries for SPDX licenses (--all: every installed library)`);
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
  console.log(`                          emitted artifact in warn/strict modes. See COMPLIANCE.md.`);
  console.log();
  console.log(`  --autosar-arxml         Also write <name>.autosar-deviations.arxml (Artop/DaVinci).`);
  console.log(`                          No-op unless --autosar is warn or strict.`);
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
  console.log(`  --expect [file]         Run hardware tests via @typecad/expect.`);
  console.log(`                          Optionally specify a test file to run a single test.`);
  console.log(`                          Discovers test files and validates via serial.`);
  console.log();
  console.log(`  --build-target <id>     Framework-specific build target identifier.`);
  console.log(`                          Required by most frameworks for --compile and --upload.`);
  console.log(`                          Example: arduino:avr:uno, esp32:esp32:esp32dev, cmake:Debug`);
  console.log();
  console.log(`  --port <port>           Serial port of the connected board.`);
  console.log(`                          Required for --upload and --monitor.`);
  console.log(`                          Example: COM4, /dev/ttyACM0`);
  console.log();
  console.log(`  --baud <rate>           Baud rate for --monitor (default: 9600)`);
  console.log();
  console.log(`  --framework <pkg>       Framework package for code generation strategy.`);
  console.log(`                          Overrides cuttlefish.config.ts framework setting.`);
  console.log(`                          Example: @typecad/framework-arduino, @typecad/framework-native`);
  console.log();
  console.log(chalk.cyan(`BUILD COMMAND`));
  console.log();
  console.log(`  build                    Build using entry point from cuttlefish.config.ts`);
  console.log(`                           Requires 'entry' field in config file.`);
  console.log(`                           Supports all transpile, compile, upload, and watch options.`);
  console.log();
  console.log(`  preview                  Start a browser preview for the configured UI display.`);
  console.log(`                           Uses cuttlefish.config.ts by default.`);
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
  console.log(`                          Reads .cuttlefish/breakpoints.json (written by the`);
  console.log(`                          TypeCAD Debug VS Code extension). At each breakpoint the`);
  console.log(`                          firmware prints the location, original line, and in-scope`);
  console.log(`                          variables, then halts — press ENTER over serial to continue.`);
  console.log();
  console.log(`  --help, -h              Show this help message`);
  console.log();
  console.log(chalk.cyan(`PROJECT CREATION`));
  console.log();
  console.log(`  create [name]           Create a new TypeCAD project`);
  console.log(`                          Interactive wizard if no --target flag.`);
  console.log();
  console.log(`  --target, -t <id>       Target platform (native, arduino-uno, esp32-devkit)`);
  console.log();
  console.log(`  --board, -b <id>        Alias for --target`);
  console.log();
  console.log(`  --framework, -f <pkg>   Framework (arduino, avr, native)`);
  console.log();
  console.log(`  --baud <rate>           Serial baud rate (default: 9600)`);
  console.log();
  console.log(`  --no-sketch             Skip generating starter sketch`);
  console.log();
  console.log(`  --outDir, -o <path>     Output directory (default: ./<name>)`);
  console.log();
  console.log(chalk.cyan(`EXAMPLES`));
  console.log();
  console.log(chalk.gray(`  # Interactive project setup`));
  console.log(`  cuttlefish create`);
  console.log();
  console.log(chalk.gray(`  # Native desktop project`));
  console.log(`  cuttlefish create my-app --target native`);
  console.log();
  console.log(chalk.gray(`  # Arduino Uno project`));
  console.log(`  cuttlefish create my-project --target arduino-uno`);
  console.log();
  console.log(chalk.gray(`  # Build using config entry point`));
  console.log(`  cuttlefish build --compile --upload --port COM4`);
  console.log();
  console.log(chalk.gray(`  # Build in watch mode`));
  console.log(`  cuttlefish build --watch`);
  console.log();
  console.log(chalk.gray(`  # Transpile to generic C++`));
  console.log(`  cuttlefish src/main.ts`);
  console.log();
  console.log(chalk.gray(`  # Transpile using Arduino framework`));
  console.log(`  cuttlefish sketch.ts --framework @typecad/framework-arduino --outDir ./build`);
  console.log();
  console.log(chalk.gray(`  # Transpile and compile for Arduino Uno`));
  console.log(`  cuttlefish sketch.ts --framework @typecad/framework-arduino --compile --build-target arduino:avr:uno`);
  console.log();
  console.log(chalk.gray(`  # Transpile, compile, and upload`));
  console.log(`  cuttlefish sketch.ts --framework @typecad/framework-arduino --compile --upload --build-target arduino:avr:uno --port COM4`);
  console.log();
  console.log(chalk.gray(`  # Full chain: transpile → compile → upload → monitor`));
  console.log(`  cuttlefish sketch.ts --framework @typecad/framework-arduino --compile --upload --monitor --build-target arduino:avr:uno --port COM4 --baud 115200`);
  console.log();
  console.log(chalk.gray(`  # Watch mode: auto-retranspile on changes`));
  console.log(`  cuttlefish sketch.ts --watch`);
  console.log();
  console.log(chalk.gray(`  # Watch and auto-compile for Arduino`));
  console.log(`  cuttlefish sketch.ts --framework @typecad/framework-arduino --watch --compile --build-target arduino:avr:uno`);
  console.log();
  console.log(chalk.gray(`  # Generate library definitions from imports`));
  console.log(`  cuttlefish gen-libdefs src/sensor.ts`);
  console.log();
  console.log(chalk.gray(`  # Map a C++ error to TypeScript source`));
  console.log(`  cuttlefish map-error .build/sketch.cpp.map --line 42 --column 5 --message "undefined reference"`);
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
  const baud = readNumberFlag(argv, ["--baud"], 9600) ?? 9600;
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
  // effective port (CLI --port flag OR config.console.port). This allows
  // setting the port in cuttlefish.config.ts instead of on every command.
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
  };
}

export function parseCommandLine(argv: string[]): CommandLineOptions | CreateCommandOptions | BoardAddCommandOptions | "help" {
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
    const noSketch = argv.includes("--no-sketch");

    const baud = baudRaw && !Number.isNaN(Number(baudRaw)) ? Number(baudRaw) : undefined;

    return {
      command: "create",
      projectName,
      target,
      baud,
      framework,
      noSketch,
      outDir: outDir ? path.resolve(process.cwd(), outDir) : undefined,
    };
  }

  if (firstArg === "create-board") {
    throw new Error(`The 'create-board' command has been removed. Board scaffolding is now in @typecad/create.`);
  }

  if (firstArg === "init") {
    throw new Error(`Use 'cuttlefish create' instead of 'cuttlefish init'.`);
  }

  // build subcommand — entry point comes from cuttlefish.config.ts
  if (firstArg === "build") {
    return parsePipelineCommand(argv, "build");
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

  // doctor subcommand — verify arduino-cli + board core presence
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

  // licenses subcommand — scan installed Arduino libraries for SPDX licenses
  if (firstArg === "licenses") {
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

  // Named subcommands
  if (firstArg === "gen-libdefs" || firstArg === "gen-decls" || firstArg === "map-error") {
    const command = firstArg;

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

    if (command === "map-error") {
      const mapFile = argv[3];
      if (!mapFile) {
        throw new Error("Missing source map path for map-error.");
      }

      const cppLineRaw = readFirstFlagValue(argv, ["--line", "--cpp-line"]);
      if (!cppLineRaw || Number.isNaN(Number(cppLineRaw))) {
        throw new Error("map-error requires --line <number>.");
      }

      const cppColumnRaw = readFirstFlagValue(argv, ["--column", "--cpp-column"]);
      const cppFile = readFirstFlagValue(argv, ["--cpp-file"]);
      const message = readFirstFlagValue(argv, ["--message"]);

      return {
        command,
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
        mapFile: path.resolve(process.cwd(), mapFile),
        cppFile: cppFile ? path.resolve(process.cwd(), cppFile) : undefined,
        cppLine: Number(cppLineRaw),
        cppColumn: cppColumnRaw ? Number(cppColumnRaw) : 1,
        message,
      };
    }

    // gen-decls - generate .d.ts from C++ files
    if (command === "gen-decls") {
      const allFlag = argv.includes("--all");
      const componentsFlag = argv.includes("--components");

      if (allFlag && componentsFlag) {
        throw new Error(
          "gen-decls: --components and --all are mutually exclusive. Use one or the other.",
        );
      }

      // The positional path may sit at argv[3] or argv[4] depending on whether
      // --all precedes or follows it. Scan argv starting after the subcommand
      // name (argv[2]) for the first token that is not a flag and not a known
      // flag's value. This mirrors the default-pipeline approach of "first
      // non-flag token wins".
      const booleanFlags = new Set(["--all", "--components"]);
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

      // --components mode: scan managed_components/ + components/ declared in
      // cuttlefish.config.ts. Falls back to cwd when no path is given.
      if (componentsFlag) {
        const componentsDir = inputPath || process.cwd();
        return {
          command: "gen-decls",
          inputFile: undefined,
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
          scanDir: undefined,
          componentsDir: path.resolve(process.cwd(), componentsDir),
        } as CommandLineOptions;
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
        // Custom fields for gen-decls
        scanDir: scanDir ? path.resolve(process.cwd(), scanDir) : undefined,
      } as CommandLineOptions;
    }

    // gen-libdefs
    const inputFile = argv[3];
    if (!inputFile) {
      throw new Error("Missing input TypeScript file path.");
    }

    return {
      command,
      inputFile: path.resolve(process.cwd(), inputFile),
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
    };
  }

  // Default: firstArg is the input file (unless it's a flag like --expect)
  const inputFile = firstArg.startsWith("-") ? undefined : firstArg;
  return parsePipelineCommand(argv, "default", inputFile);
}
