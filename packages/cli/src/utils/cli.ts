import path from "node:path";
import { CommandLineOptions, EmitMode, PlatformContext, TargetProfile, TreeShakingOptions, ScaffoldCommandOptions } from "../types";

const VERSION = "0.1.0";

export function printHelp(): void {
  console.log(`
typecode v${VERSION} - TypeScript to C++ transpiler for embedded systems

USAGE
  typecode <input.ts> [options]
  typecode gen-libdefs <input.ts>
  typecode gen-decls <input.cpp|--all <directory>>
  typecode map-error <mapFile> [options]
  typecode create-board <name> [options]

Transpilation is always performed first. Use --compile, --upload, and
--monitor to chain arduino-cli operations after transpilation.

OPTIONS
  --emit <mode>           Emit mode: "cpp" or "split" (default: split)
                          - cpp: single output file
                          - split: separate .cpp and .h files
                          Note: Arduino target always emits a single .ino file

  --target <platform>     Target platform: "arduino" or "generic" (default: generic)
                          Automatically set to "arduino" when --compile, --upload,
                          or --monitor are used.

  --outDir, --out-dir <path>
                          Output directory for generated files (default: input file directory)

  --emit-maps <bool>      Emit source maps: "true" or "false" (default: true)
                          Source maps enable mapping C++ errors back to TypeScript

ARDUINO COMMANDS (chain in order: --compile → --upload → --monitor)
  --compile               Compile the generated Arduino sketch with arduino-cli.
                          Requires: --fqbn

  --upload                Upload the compiled sketch to the board.
                          Requires: --compile, --fqbn, --port

  --monitor               Open an interactive serial monitor after upload.
                          Requires: --port

  --fqbn <package:arch:board>
                          Fully Qualified Board Name.
                          Required for --compile and --upload.
                          Example: arduino:avr:uno, esp32:esp32:esp32dev

  --port <port>           Serial port of the connected board.
                          Required for --upload and --monitor.
                          Example: COM4, /dev/ttyACM0

  --baud <rate>           Baud rate for --monitor (default: 9600)

TREE-SHAKING OPTIONS
  --no-tree-shake          Disable tree-shaking (dead code elimination)

  --keep-unused-enums      Keep all enums even if not referenced

  --keep-unused-classes    Keep all classes even if not instantiated

  --keep-unused-types      Keep all type aliases even if not used

  --keep-unused-variables   Keep all top-level variables even if not referenced

  --entry-point <name>     Add a custom entry point symbol (repeatable)
                           Default entry points: setup/loop (Arduino), main (generic)

  --help, -h              Show this help message

BOARD SCAFFOLDING
  create-board <name>     Create a new board package scaffold
                          Creates a complete board definition package under packages/

  --arch <id>             Architecture: avr, esp32, esp32s2, esp32s3, esp32c3, rp2040, samd, stm32, nrf52

  --display-name <name>   Human-readable board name

  --vendor <name>         Board vendor/manufacturer

  --mcu <part>            MCU part number (e.g., ATmega328P, ESP32)

  --clock <mhz>           Clock speed in MHz

  --flash <kb>            Flash memory size in KB

  --sram <kb>             SRAM size in KB

  --eeprom <kb>           EEPROM size in KB

  --fqbn <value>          Fully Qualified Board Name for arduino-cli

  --outDir <path>         Output directory (default: packages/board-<name>)

  --minimal               Generate only required files

EXAMPLES
  # Transpile to generic C++
  typecode src/main.ts

  # Transpile to Arduino sketch
  typecode sketch.ts --target arduino --outDir ./build

  # Transpile and compile for Arduino Uno
  typecode sketch.ts --compile --fqbn arduino:avr:uno

  # Transpile, compile, and upload
  typecode sketch.ts --compile --upload --fqbn arduino:avr:uno --port COM4

  # Full chain: transpile → compile → upload → monitor
  typecode sketch.ts --compile --upload --monitor --fqbn arduino:avr:uno --port COM4 --baud 115200

  # Generate library definitions from imports
  typecode gen-libdefs src/sensor.ts

  # Map a C++ error to TypeScript source
  typecode map-error .build/sketch.cpp.map --line 42 --column 5 --message "undefined reference"
`);
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

export function parseCommandLine(argv: string[]): CommandLineOptions | ScaffoldCommandOptions | "help" {
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
  const debug = argv.includes("--debug");
  const noTranspile = argv.includes("--no-transpile");
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
    port,
    baud,
    platformContext,
    treeShaking,
    debug,
  };
}
