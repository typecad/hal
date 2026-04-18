import path from "node:path";
import { CommandLineOptions, EmitMode, PlatformContext, TargetProfile, TreeShakingOptions, ScaffoldCommandOptions, InitCommandOptions } from "../types";

import chalk from "chalk";

const VERSION = "0.1.0";
const ICON_TYPECODE = "⤳";

export function printHelp(): void {
  console.log();
  console.log(chalk.cyan(`${ICON_TYPECODE} typeCode`) + chalk.gray(` v${VERSION}`));
  console.log(chalk.gray(`  TypeScript to C++ transpiler for embedded systems`));
  console.log();
  console.log(chalk.cyan(`USAGE`));
  console.log();
  console.log(`  typecode <input.ts> [options]`);
  console.log(`  typecode build [options]`);
  console.log(`  typecode init [name] [options]`);
  console.log(`  typecode gen-libdefs <input.ts>`);
  console.log(`  typecode gen-decls <input.cpp|--all <directory>>`);
  console.log(`  typecode map-error <mapFile> [options]`);
  console.log(`  typecode create-board <name> [options]`);
  console.log();
  console.log(chalk.gray(`Transpilation is always performed first. Use --compile, --upload, and`));
  console.log(chalk.gray(`--monitor to chain arduino-cli operations after transpilation.`));
  console.log();
  console.log(chalk.cyan(`OPTIONS`));
  console.log();
  console.log(`  --emit <mode>           Emit mode: "cpp" or "split" (default: split)`);
  console.log(`                          - cpp: single output file`);
  console.log(`                          - split: separate .cpp and .h files`);
  console.log(`                          Note: Arduino target always emits a single .ino file`);
  console.log();
  console.log(`  --target <platform>     Target platform: "arduino" or "generic" (default: generic)`);
  console.log(`                          Automatically set to "arduino" when --compile, --upload,`);
  console.log(`                          or --monitor are used.`);
  console.log();
  console.log(`  --outDir, --out-dir <path>`);
  console.log(`                          Output directory for generated files (default: input file directory)`);
  console.log();
  console.log(`  --emit-maps <bool>      Emit source maps: "true" or "false" (default: true)`);
  console.log(`                          Source maps enable mapping C++ errors back to TypeScript`);
  console.log();
  console.log(chalk.cyan(`ARDUINO COMMANDS`) + chalk.gray(` (chain in order: --compile → --upload → --monitor)`));
  console.log();
  console.log(`  --compile               Compile the generated Arduino sketch with arduino-cli.`);
  console.log(`                          Requires: --fqbn`);
  console.log();
  console.log(`  --upload                Upload the compiled sketch to the board.`);
  console.log(`                          Requires: --compile, --fqbn, --port`);
  console.log();
  console.log(`  --monitor               Open an interactive serial monitor after upload.`);
  console.log(`                          Requires: --port`);
  console.log();
  console.log(`  --fqbn <package:arch:board>`);
  console.log(`                          Fully Qualified Board Name.`);
  console.log(`                          Required for --compile and --upload.`);
  console.log(`                          Example: arduino:avr:uno, esp32:esp32:esp32dev`);
  console.log();
  console.log(`  --port <port>           Serial port of the connected board.`);
  console.log(`                          Required for --upload and --monitor.`);
  console.log(`                          Example: COM4, /dev/ttyACM0`);
  console.log();
  console.log(`  --baud <rate>           Baud rate for --monitor (default: 9600)`);
  console.log();
  console.log(chalk.cyan(`BUILD COMMAND`));
  console.log();
  console.log(`  build                    Build using entry point from typecode.config.ts`);
  console.log(`                           Requires 'entry' field in config file.`);
  console.log(`                           Supports all transpile, compile, upload, and watch options.`);
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
  console.log(`                           Default entry points: setup/loop (Arduino), main (generic)`);
  console.log();
  console.log(`  --help, -h              Show this help message`);
  console.log();
  console.log(chalk.cyan(`PROJECT SCAFFOLDING`));
  console.log();
  console.log(`  init [name]             Create a new TypeCode project`);
  console.log(`                          Generates package.json, tsconfig.json, typecode.config.ts,`);
  console.log(`                          and an optional starter sketch.`);
  console.log();
  console.log(`  --board <id>            Board to target (e.g., arduino-uno)`);
  console.log();
  console.log(`  --framework <id>        Framework: arduino or avr (default: arduino)`);
  console.log();
  console.log(`  --baud <rate>           Serial baud rate (default: 9600)`);
  console.log();
  console.log(`  --no-sketch             Skip generating starter sketch`);
  console.log();
  console.log(`  --outDir <path>         Output directory (default: ./<name>)`);
  console.log();
  console.log(chalk.cyan(`BOARD SCAFFOLDING`));
  console.log();
  console.log(`  create-board <name>     Create a new board package scaffold`);
  console.log(`                          Creates a complete board definition package under packages/`);
  console.log();
  console.log(`  --arch <id>             Architecture: avr, esp32, esp32s2, esp32s3, esp32c3, rp2040, samd, stm32, nrf52`);
  console.log();
  console.log(`  --display-name <name>   Human-readable board name`);
  console.log();
  console.log(`  --vendor <name>         Board vendor/manufacturer`);
  console.log();
  console.log(`  --mcu <part>            MCU part number (e.g., ATmega328P, ESP32)`);
  console.log();
  console.log(`  --clock <mhz>           Clock speed in MHz`);
  console.log();
  console.log(`  --flash <kb>            Flash memory size in KB`);
  console.log();
  console.log(`  --sram <kb>             SRAM size in KB`);
  console.log();
  console.log(`  --eeprom <kb>           EEPROM size in KB`);
  console.log();
  console.log(`  --fqbn <value>          Fully Qualified Board Name for arduino-cli`);
  console.log();
  console.log(`  --outDir <path>         Output directory (default: packages/board-<name>)`);
  console.log();
  console.log(`  --minimal               Generate only required files`);
  console.log();
  console.log(chalk.cyan(`EXAMPLES`));
  console.log();
  console.log(chalk.gray(`  # Interactive project setup`));
  console.log(`  typecode init`);
  console.log();
  console.log(chalk.gray(`  # Non-interactive project setup`));
  console.log(`  typecode init my-project --board arduino-uno --framework arduino`);
  console.log();
  console.log(chalk.gray(`  # Build using config entry point`));
  console.log(`  typecode build --compile --upload --port COM4`);
  console.log();
  console.log(chalk.gray(`  # Build in watch mode`));
  console.log(`  typecode build --watch`);
  console.log();
  console.log(chalk.gray(`  # Transpile to generic C++`));
  console.log(`  typecode src/main.ts`);
  console.log();
  console.log(chalk.gray(`  # Transpile to Arduino sketch`));
  console.log(`  typecode sketch.ts --target arduino --outDir ./build`);
  console.log();
  console.log(chalk.gray(`  # Transpile and compile for Arduino Uno`));
  console.log(`  typecode sketch.ts --compile --fqbn arduino:avr:uno`);
  console.log();
  console.log(chalk.gray(`  # Transpile, compile, and upload`));
  console.log(`  typecode sketch.ts --compile --upload --fqbn arduino:avr:uno --port COM4`);
  console.log();
  console.log(chalk.gray(`  # Full chain: transpile → compile → upload → monitor`));
  console.log(`  typecode sketch.ts --compile --upload --monitor --fqbn arduino:avr:uno --port COM4 --baud 115200`);
  console.log();
  console.log(chalk.gray(`  # Watch mode: auto-retranspile on changes`));
  console.log(`  typecode sketch.ts --watch`);
  console.log();
  console.log(chalk.gray(`  # Watch and auto-compile for Arduino`));
  console.log(`  typecode sketch.ts --watch --compile --fqbn arduino:avr:uno`);
  console.log();
  console.log(chalk.gray(`  # Generate library definitions from imports`));
  console.log(`  typecode gen-libdefs src/sensor.ts`);
  console.log();
  console.log(chalk.gray(`  # Map a C++ error to TypeScript source`));
  console.log(`  typecode map-error .build/sketch.cpp.map --line 42 --column 5 --message "undefined reference"`);
  console.log();
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    return undefined;
  }
  return args[index + 1];
}

function readFlags(args: string[], flags: string[]): string | undefined {
  for (const flag of flags) {
    const value = readFlag(args, flag);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function parseCommandLine(argv: string[]): CommandLineOptions | ScaffoldCommandOptions | InitCommandOptions | "help" {
  const firstArg = argv[2];

  if (!firstArg || firstArg === "--help" || firstArg === "-h") {
    return "help";
  }

  // create-board subcommand
  if (firstArg === "create-board") {
    const name = argv[3];
    if (!name || name.startsWith("-")) {
      throw new Error("Missing board name. Use: create-board <name> [options]");
    }

    const displayName = readFlags(argv, ["--display-name", "--name"]);
    const vendor = readFlags(argv, ["--vendor"]);
    const architecture = readFlags(argv, ["--arch", "--architecture"]);
    const mcu = readFlags(argv, ["--mcu"]);
    const clockSpeedRaw = readFlags(argv, ["--clock", "--clock-speed"]);
    const flashRaw = readFlags(argv, ["--flash", "--flash-kb"]);
    const sramRaw = readFlags(argv, ["--sram", "--sram-kb"]);
    const eepromRaw = readFlags(argv, ["--eeprom", "--eeprom-kb"]);
    const fqbn = readFlags(argv, ["--fqbn"]);
    const outDir = readFlags(argv, ["--outDir", "--out-dir"]);
    const minimal = argv.includes("--minimal");

    const clockSpeedMhz = clockSpeedRaw ? Number(clockSpeedRaw) : undefined;
    const flashKb = flashRaw ? Number(flashRaw) : undefined;
    const sramKb = sramRaw ? Number(sramRaw) : undefined;
    const eepromKb = eepromRaw ? Number(eepromRaw) : undefined;

    return {
      command: "create-board",
      name,
      displayName,
      vendor,
      architecture,
      mcu,
      clockSpeedMhz,
      flashKb,
      sramKb,
      eepromKb,
      fqbn,
      outDir: outDir ? path.resolve(process.cwd(), outDir) : undefined,
      minimal,
    } as ScaffoldCommandOptions;
  }

  // init subcommand
  if (firstArg === "init") {
    // Project name is optional positional arg after 'init'
    const secondArg = argv[3];
    const projectName = secondArg && !secondArg.startsWith("-") ? secondArg : undefined;

    const board = readFlags(argv, ["--board"]);
    const framework = readFlags(argv, ["--framework"]);
    const baudRaw = readFlags(argv, ["--baud"]);
    const outDir = readFlags(argv, ["--outDir", "--out-dir"]);
    const noSketch = argv.includes("--no-sketch");

    const baud = baudRaw && !Number.isNaN(Number(baudRaw)) ? Number(baudRaw) : undefined;

    return {
      command: "init",
      projectName,
      board,
      framework,
      baud,
      noSketch,
      outDir: outDir ? path.resolve(process.cwd(), outDir) : undefined,
    } as InitCommandOptions;
  }

  // build subcommand — entry point comes from typecode.config.ts
  if (firstArg === "build") {
    const emitFlag = readFlags(argv, ["--emit"]);
    const targetFlag = readFlags(argv, ["--target"]);
    const outDir = readFlags(argv, ["--outDir", "--out-dir"]);
    const emitMapsFlag = readFlags(argv, ["--emit-maps"]);
    const fqbn = readFlags(argv, ["--fqbn"]);
    const port = readFlags(argv, ["--port"]);
    const baudRaw = readFlags(argv, ["--baud"]);

    const compile = argv.includes("--compile");
    const upload = argv.includes("--upload");
    const monitor = argv.includes("--monitor");
    const watch = argv.includes("--watch") || argv.includes("-w");
    const debug = argv.includes("--debug");
    const force = argv.includes("--force");
    const baud = baudRaw && !Number.isNaN(Number(baudRaw)) ? Number(baudRaw) : 9600;

    // Tree-shaking options
    const noTreeShake = argv.includes("--no-tree-shake");
    const keepUnusedEnums = argv.includes("--keep-unused-enums");
    const keepUnusedClasses = argv.includes("--keep-unused-classes");
    const keepUnusedTypes = argv.includes("--keep-unused-types");
    const keepUnusedVariables = argv.includes("--keep-unused-variables");

    const entryPoints: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--entry-point" && i + 1 < argv.length) {
        entryPoints.push(argv[i + 1]);
      }
    }

    const emitMode: EmitMode = emitFlag === "cpp" || emitFlag === "split" ? emitFlag : "split";
    const emitMaps = emitMapsFlag === undefined ? true : emitMapsFlag !== "false";

    // Auto-select arduino target when using Arduino CLI commands
    const effectiveTargetFlag = compile || upload || monitor ? "arduino" : targetFlag;
    const target: TargetProfile =
      effectiveTargetFlag === "arduino" || effectiveTargetFlag === "generic" ? effectiveTargetFlag : "generic";

    const platformContext: PlatformContext = { arduino: { fqbn } };

    // Validate flag combinations
    if (upload && !compile) {
      throw new Error("--upload requires --compile.");
    }
    if (upload && !port) {
      throw new Error("--upload requires --port <port>.");
    }
    if (monitor && !port) {
      throw new Error("--monitor requires --port <port>.");
    }
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
      command: "build",
      inputFile: undefined, // resolved later from config
      emitMode,
      target,
      outDir: outDir ? path.resolve(process.cwd(), outDir) : undefined,
      emitMaps,
      noTranspile: false,
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
    };
  }

  // Named subcommands
  if (firstArg === "gen-libdefs" || firstArg === "gen-decls" || firstArg === "map-error") {
    const command = firstArg;

    const emitFlag = readFlags(argv, ["--emit"]);
    const targetFlag = readFlags(argv, ["--target"]);
    const outDir = readFlags(argv, ["--outDir", "--out-dir"]);
    const emitMapsFlag = readFlags(argv, ["--emit-maps"]);
    const fqbn = readFlags(argv, ["--fqbn"]);

    const emitMode: EmitMode = emitFlag === "cpp" || emitFlag === "split" ? emitFlag : "split";
    const target: TargetProfile = targetFlag === "arduino" || targetFlag === "generic" ? targetFlag : "generic";
    const emitMaps = emitMapsFlag === undefined ? true : emitMapsFlag !== "false";
    const platformContext: PlatformContext = { arduino: { fqbn } };

    if (command === "map-error") {
      const mapFile = argv[3];
      if (!mapFile) {
        throw new Error("Missing source map path for map-error.");
      }

      const cppLineRaw = readFlags(argv, ["--line", "--cpp-line"]);
      if (!cppLineRaw || Number.isNaN(Number(cppLineRaw))) {
        throw new Error("map-error requires --line <number>.");
      }

      const cppColumnRaw = readFlags(argv, ["--column", "--cpp-column"]);
      const cppFile = readFlags(argv, ["--cpp-file"]);
      const message = readFlags(argv, ["--message"]);

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
      const inputPath = argv[3];
      
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

  // Warn about removed `transpile` subcommand
  if (firstArg === "transpile") {
    console.error("Error: the 'transpile' subcommand has been removed. Run: typecode <input.ts> [options]\n");
    return "help";
  }

  // Default: firstArg is the input file
  const inputFile = firstArg;

  const emitFlag = readFlags(argv, ["--emit"]);
  const targetFlag = readFlags(argv, ["--target"]);
  const outDir = readFlags(argv, ["--outDir", "--out-dir"]);
  const emitMapsFlag = readFlags(argv, ["--emit-maps"]);
  const fqbn = readFlags(argv, ["--fqbn"]);
  const port = readFlags(argv, ["--port"]);
  const baudRaw = readFlags(argv, ["--baud"]);

  const compile = argv.includes("--compile");
  const upload = argv.includes("--upload");
  const monitor = argv.includes("--monitor");
  const watch = argv.includes("--watch") || argv.includes("-w");
  const debug = argv.includes("--debug");
  const noTranspile = argv.includes("--no-transpile");
  const force = argv.includes("--force");
  const skipTypeCheck = argv.includes("--skip-type-check");
  const baud = baudRaw && !Number.isNaN(Number(baudRaw)) ? Number(baudRaw) : 9600;

  // Tree-shaking options
  const noTreeShake = argv.includes("--no-tree-shake");
  const keepUnusedEnums = argv.includes("--keep-unused-enums");
  const keepUnusedClasses = argv.includes("--keep-unused-classes");
  const keepUnusedTypes = argv.includes("--keep-unused-types");
  const keepUnusedVariables = argv.includes("--keep-unused-variables");

  const entryPoints: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--entry-point" && i + 1 < argv.length) {
      entryPoints.push(argv[i + 1]);
    }
  }

  const emitMode: EmitMode = emitFlag === "cpp" || emitFlag === "split" ? emitFlag : "split";
  const emitMaps = emitMapsFlag === undefined ? true : emitMapsFlag !== "false";

  // Auto-select arduino target when using Arduino CLI commands
  const effectiveTargetFlag = compile || upload || monitor ? "arduino" : targetFlag;
  const target: TargetProfile =
    effectiveTargetFlag === "arduino" || effectiveTargetFlag === "generic" ? effectiveTargetFlag : "generic";

  const platformContext: PlatformContext = { arduino: { fqbn } };

  // Validate flag combinations
  // Note: --compile without --fqbn is now allowed when typecode.config.ts provides fqbn
  if (upload && !compile) {
    throw new Error("--upload requires --compile.");
  }
  if (upload && !port) {
    throw new Error("--upload requires --port <port>.");
  }
  if (monitor && !port) {
    throw new Error("--monitor requires --port <port>.");
  }
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
    command: "default",
    inputFile: path.resolve(process.cwd(), inputFile),
    emitMode,
    target,
    outDir: outDir ? path.resolve(process.cwd(), outDir) : undefined,
    emitMaps,
    noTranspile,
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
  };
}