import path from "node:path";
import { CommandLineOptions, EmitMode, PlatformContext, TargetProfile } from "../types";

const VERSION = "0.1.0";

export function printHelp(): void {
  console.log(`
typecode v${VERSION} - TypeScript to C++ transpiler for embedded systems

USAGE
  typecode <command> [input] [options]

COMMANDS
  transpile <input.ts>    Transpile TypeScript to C++ source files
  gen-libdefs <input.ts>  Generate type definition files for imported libraries
  gen-types               Generate Arduino platform type declarations
  map-error <mapFile>     Map C++ compile errors back to TypeScript locations

OPTIONS
  --emit <mode>           Emit mode: "cpp" or "split" (default: split)
                          - cpp: single output file
                          - split: separate .cpp and .h files
                          Note: Arduino target always emits a single .ino file

  --target <platform>     Target platform: "arduino" or "generic" (default: generic)

  --outDir, --out-dir <path>
                          Output directory for generated files (default: input file directory)

  --emit-maps <bool>      Emit source maps: "true" or "false" (default: true)
                          Source maps enable mapping C++ errors back to TypeScript

  --compile-arduino <mode>
                          Compile Arduino sketch after transpilation
                          - true: compile and show errors
                          - strict: compile and fail on any output
                          - false: do not compile (default)

  --fqbn <package:arch:board>
                          Fully Qualified Board Name for Arduino compilation
                          Example: arduino:avr:uno, arduino:samd:mkr1000

  --arduino-arch, --arch <arch>
                          Arduino architecture override (e.g., avr, samd, esp32)

  --arduino-core, --core <core>
                          Arduino core path override

  --arduino-variant, --variant <variant>
                          Arduino board variant override

  --arduino-cli-json <path>
                          Path to arduino-cli.json for platform metadata

  --help, -h              Show this help message

EXAMPLES
  # Transpile to generic C++
  typecode transpile src/main.ts

  # Transpile to Arduino sketch
  typecode transpile sketch.ts --target arduino --outDir ./build

  # Transpile and compile for Arduino Uno
  typecode transpile sketch.ts --target arduino --fqbn arduino:avr:uno --compile-arduino

  # Transpile for ESP32
  typecode transpile sketch.ts --target arduino --fqbn esp32:esp32:esp32dev

  # Generate library definitions from imports
  typecode gen-libdefs src/sensor.ts

  # Generate Arduino type declarations
  typecode gen-types --fqbn arduino:avr:uno

  # Map a C++ error to TypeScript source
  typecode map-error .build/sketch.cpp.map --line 42 --column 5 --message "undefined reference"

  # Map error with specific C++ file
  typecode map-error .build/sketch.cpp.map --line 10 --cpp-file .build/sketch.cpp
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

export function parseCommandLine(argv: string[]): CommandLineOptions | "help" {
  // Check for --help, -h, or no command
  const command = argv[2];
  if (!command || command === "--help" || command === "-h") {
    return "help";
  }

  if (command !== "transpile" && command !== "gen-libdefs" && command !== "gen-types" && command !== "map-error") {
    console.error(`Unknown command: ${command}\n`);
    return "help";
  }

  const emitFlag = readFlags(argv, ["--emit"]);
  const targetFlag = readFlags(argv, ["--target"]);
  const outDir = readFlags(argv, ["--outDir", "--out-dir"]);
  const emitMapsFlag = readFlags(argv, ["--emit-maps"]);
  const compileArduinoFlag = readFlags(argv, ["--compile-arduino"]);
  const fqbn = readFlags(argv, ["--fqbn"]);
  const architecture = readFlags(argv, ["--arduino-arch", "--arch"]);
  const core = readFlags(argv, ["--arduino-core", "--core"]);
  const variant = readFlags(argv, ["--arduino-variant", "--variant"]);
  const arduinoCliJson = readFlags(argv, ["--arduino-cli-json"]);

  const emitMode: EmitMode = emitFlag === "cpp" || emitFlag === "split" ? emitFlag : "split";
  const target: TargetProfile = targetFlag === "arduino" || targetFlag === "generic" ? targetFlag : "generic";
  const emitMaps = emitMapsFlag === undefined ? true : emitMapsFlag !== "false";
  const compileArduino: false | true | "strict" =
    compileArduinoFlag === "strict"
      ? "strict"
      : compileArduinoFlag === undefined
        ? false
        : compileArduinoFlag !== "false";
  const platformContext: PlatformContext = {
    arduino: {
      fqbn,
      architecture,
      core,
      variant,
      arduinoCliJsonPath: arduinoCliJson ? path.resolve(process.cwd(), arduinoCliJson) : undefined,
    },
  };

  if (command === "map-error") {
    const mapFile = argv[3];
    if (!mapFile) {
      throw new Error("Missing source map path (or generated .cpp/.h path) for map-error.");
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
      compileArduino,
      platformContext,
      mapFile: path.resolve(process.cwd(), mapFile),
      cppFile: cppFile ? path.resolve(process.cwd(), cppFile) : undefined,
      cppLine: Number(cppLineRaw),
      cppColumn: cppColumnRaw ? Number(cppColumnRaw) : 1,
      message,
    };
  }

  // gen-types doesn't require an input file
  if (command === "gen-types") {
    return {
      command,
      inputFile: undefined,
      emitMode,
      target,
      outDir: outDir ? path.resolve(process.cwd(), outDir) : undefined,
      emitMaps,
      compileArduino,
      platformContext,
    };
  }

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
    compileArduino,
    platformContext,
  };
}
