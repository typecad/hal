import fs from "node:fs";
import path from "node:path";
import { ArduinoPlatformContext, Diagnostic, LibraryDefinition } from "../types";
import { ArduinoCliMetadata, loadArduinoCliMetadata } from "./arduino-cli-metadata";
import { readText } from "../utils/fs";

export interface ArduinoTypeGeneratorOptions {
  fqbn?: string;
  architecture?: string;
  arduinoCliJsonPath?: string;
  outputPath: string;
}

export interface ArduinoTypeGeneratorResult {
  outputPath: string;
  diagnostics: Diagnostic[];
}

interface ArduinoBuiltinFunction {
  name: string;
  signature: string;
}

interface ArduinoFrameworkLibrary {
  name: string;
  headers: string[];
  declarations: string[];
  modules?: Array<{ name: string; exports: string[] }>;
}

// Common Arduino functions with their TypeScript signatures
const ARDUINO_BUILTIN_FUNCTIONS: ArduinoBuiltinFunction[] = [
  // Digital I/O
  { name: "pinMode", signature: "declare function pinMode(pin: number, mode: number): void;" },
  { name: "digitalWrite", signature: "declare function digitalWrite(pin: number, value: number): void;" },
  { name: "digitalRead", signature: "declare function digitalRead(pin: number): number;" },
  
  // Analog I/O
  { name: "analogRead", signature: "declare function analogRead(pin: number): number;" },
  { name: "analogWrite", signature: "declare function analogWrite(pin: number, value: number): void;" },
  { name: "analogReference", signature: "declare function analogReference(mode: number): void;" },
  
  // Time
  { name: "delay", signature: "declare function delay(ms: number): void;" },
  { name: "delayMicroseconds", signature: "declare function delayMicroseconds(us: number): void;" },
  { name: "millis", signature: "declare function millis(): number;" },
  { name: "micros", signature: "declare function micros(): number;" },
  
  // Math
  { name: "min", signature: "declare function min<T extends number>(a: T, b: T): T;" },
  { name: "max", signature: "declare function max<T extends number>(a: T, b: T): T;" },
  { name: "abs", signature: "declare function abs<T extends number>(x: T): T;" },
  { name: "constrain", signature: "declare function constrain<T extends number>(x: T, a: T, b: T): T;" },
  { name: "map", signature: "declare function map(value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number;" },
  { name: "pow", signature: "declare function pow(base: number, exponent: number): number;" },
  { name: "sqrt", signature: "declare function sqrt(x: number): number;" },
  { name: "sq", signature: "declare function sq(x: number): number;" },
  
  // Random
  { name: "randomSeed", signature: "declare function randomSeed(seed: number): void;" },
  { name: "random", signature: "declare function random(max: number): number; declare function random(min: number, max: number): number;" },
  
  // Bits and Bytes
  { name: "lowByte", signature: "declare function lowByte(value: number): number;" },
  { name: "highByte", signature: "declare function highByte(value: number): number;" },
  { name: "bitRead", signature: "declare function bitRead(value: number, bit: number): number;" },
  { name: "bitWrite", signature: "declare function bitWrite(value: number, bit: number, bitvalue: number): void;" },
  { name: "bitSet", signature: "declare function bitSet(value: number, bit: number): void;" },
  { name: "bitClear", signature: "declare function bitClear(value: number, bit: number): void;" },
  { name: "bit", signature: "declare function bit(n: number): number;" },
  
  // Interrupts
  { name: "attachInterrupt", signature: "declare function attachInterrupt(pin: number, callback: () => void, mode: number): void;" },
  { name: "detachInterrupt", signature: "declare function detachInterrupt(pin: number): void;" },
  { name: "interrupts", signature: "declare function interrupts(): void;" },
  { name: "noInterrupts", signature: "declare function noInterrupts(): void;" },
  
  // Tone
  { name: "tone", signature: "declare function tone(pin: number, frequency: number, duration?: number): void;" },
  { name: "noTone", signature: "declare function noTone(pin: number): void;" },
  
  // Pulse
  { name: "pulseIn", signature: "declare function pulseIn(pin: number, value: number, timeout?: number): number;" },
  { name: "pulseInLong", signature: "declare function pulseInLong(pin: number, value: number, timeout?: number): number;" },
  
  // Shift
  { name: "shiftOut", signature: "declare function shiftOut(dataPin: number, clockPin: number, bitOrder: number, val: number): void;" },
  { name: "shiftIn", signature: "declare function shiftIn(dataPin: number, clockPin: number, bitOrder: number): number;" },
];

// Serial interface type definition
const SERIAL_INTERFACE = `interface SerialInterface {
  begin(baud: number): void;
  begin(baud: number, config: number): void;
  end(): void;
  available(): number;
  availableForWrite(): number;
  read(): number;
  readBytes(buffer: Buffer, length: number): number;
  readBytesUntil(character: string, buffer: Buffer, length: number): number;
  readString(): string;
  readStringUntil(terminator: string): string;
  peek(): number;
  flush(): void;
  write(val: number): number;
  write(str: string): number;
  write(buffer: Buffer, size: number): number;
  print(data: string | number): number;
  print(data: string | number, format: number): number;
  println(): number;
  println(data: string | number): number;
  println(data: string | number, format: number): number;
  setDebugOutput(enable: boolean): void;
}`;

function getFrameworkLibraries(architecture?: string): ArduinoFrameworkLibrary[] {
  const normalized = architecture?.toLowerCase();
  const libs: ArduinoFrameworkLibrary[] = [];

  libs.push({
    name: "Wire",
    headers: ["<Wire.h>"],
    declarations: [
      "interface TwoWire {",
      "  begin(): void;",
      "  begin(address: number): void;",
      "  end(): void;",
      "  setClock(frequency: number): void;",
      "  beginTransmission(address: number): void;",
      "  write(value: number): number;",
      "  write(data: string): number;",
      "  write(buffer: Buffer, quantity?: number): number;",
      "  endTransmission(stop?: boolean): number;",
      "  requestFrom(address: number, quantity: number, stop?: boolean): number;",
      "  available(): number;",
      "  read(): number;",
      "  flush(): void;",
      "  onReceive(handler: (length: number) => void): void;",
      "  onRequest(handler: () => void): void;",
      "}",
      "declare const Wire: TwoWire;",
    ],
    modules: [
      { name: "wire", exports: ["Wire"] },
      { name: "Wire", exports: ["Wire"] },
    ],
  });

  libs.push({
    name: "SPI",
    headers: ["<SPI.h>"],
    declarations: [
      "interface SPISettings {",
      "  clock: number;",
      "  bitOrder: number;",
      "  dataMode: number;",
      "}",
      "declare const MSBFIRST: number;",
      "declare const LSBFIRST: number;",
      "declare const SPI_MODE0: number;",
      "declare const SPI_MODE1: number;",
      "declare const SPI_MODE2: number;",
      "declare const SPI_MODE3: number;",
      "interface SPIClass {",
      "  begin(): void;",
      "  end(): void;",
      "  beginTransaction(settings: SPISettings): void;",
      "  endTransaction(): void;",
      "  transfer(value: number): number;",
      "  transfer(buffer: Buffer, count: number): void;",
      "}",
      "declare const SPI: SPIClass;",
    ],
    modules: [
      { name: "spi", exports: ["SPI"] },
      { name: "SPI", exports: ["SPI"] },
    ],
  });

  if (normalized === "avr" || normalized === "samd" || normalized === "rp2040" || !normalized) {
    libs.push({
      name: "EEPROM",
      headers: ["<EEPROM.h>"],
      declarations: [
        "interface EEPROMClass {",
        "  read(address: number): number;",
        "  write(address: number, value: number): void;",
        "  update(address: number, value: number): void;",
        "  get<T>(address: number, data: T): T;",
        "  put<T>(address: number, data: T): T;",
        "  length(): number;",
        "}",
        "declare const EEPROM: EEPROMClass;",
      ],
      modules: [
        { name: "eeprom", exports: ["EEPROM"] },
        { name: "EEPROM", exports: ["EEPROM"] },
      ],
    });
  }

  if (normalized === "avr" || normalized === "esp32" || normalized === "samd" || normalized === "rp2040" || !normalized) {
    libs.push({
      name: "Tone",
      headers: ["<Tone.h>"],
      declarations: [
        "interface ToneGenerator {",
        "  begin(pin: number): void;",
        "  play(frequency: number, duration?: number): void;",
        "  stop(): void;",
        "}",
      ],
      modules: [
        { name: "tone", exports: ["tone", "noTone"] },
        { name: "Tone", exports: ["tone", "noTone"] },
      ],
    });
  }

  return libs;
}

function getArchitectureCapabilities(architecture?: string): {
  functions: Set<string>;
  globals: Set<string>;
  pins: Record<string, number>;
} {
  const baseFunctions = new Set(ARDUINO_BUILTIN_FUNCTIONS.map(f => f.name));
  const baseGlobals = new Set(["HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "LED_BUILTIN", "Serial"]);
  const basePins: Record<string, number> = {};
  
  // Add analog pins A0-A15
  for (let i = 0; i <= 15; i++) {
    basePins[`A${i}`] = i;
  }
  
  switch (architecture?.toLowerCase()) {
    case "avr":
      baseGlobals.add("INPUT_PULLDOWN");
      return { functions: baseFunctions, globals: baseGlobals, pins: basePins };
    case "esp32":
      baseGlobals.add("INPUT_PULLDOWN");
      baseGlobals.add("LED_BUILTIN");
      // ESP32 has different A0 mapping
      basePins["A0"] = 36;
      return { functions: baseFunctions, globals: baseGlobals, pins: basePins };
    case "samd":
      return { functions: baseFunctions, globals: baseGlobals, pins: basePins };
    case "rp2040":
      return { functions: baseFunctions, globals: baseGlobals, pins: basePins };
    default:
      return { functions: baseFunctions, globals: baseGlobals, pins: basePins };
  }
}

function generateTypeDeclarations(
  architecture?: string,
  metadata?: ArduinoCliMetadata,
): string {
  const lines: string[] = [];
  const caps = getArchitectureCapabilities(architecture);
  
  // Merge with CLI metadata if available
  const functions = new Set([...caps.functions, ...(metadata?.builtinFunctions ?? [])]);
  const globals = new Set([...caps.globals, ...(metadata?.builtinGlobals ?? [])]);
  const pins = { ...caps.pins, ...(metadata?.pins ?? {}) };
  
  // Header
  lines.push("// Auto-generated by typecode - do not edit");
  if (architecture) {
    lines.push(`// Architecture: ${architecture}`);
  }
  if (metadata?.architecture) {
    lines.push(`// Detected architecture: ${metadata.architecture}`);
  }
  lines.push("");
  
  // Pin constants
  lines.push("// Pin constants");
  for (const [name, value] of Object.entries(pins).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`declare const ${name}: ${value};`);
  }
  lines.push("");
  
  // Mode/voltage constants
  lines.push("// Pin modes and voltage levels");
  lines.push("declare const HIGH: 0x1;");
  lines.push("declare const LOW: 0x0;");
  lines.push("declare const INPUT: 0x0;");
  lines.push("declare const OUTPUT: 0x1;");
  lines.push("declare const INPUT_PULLUP: 0x2;");
  if (globals.has("INPUT_PULLDOWN")) {
    lines.push("declare const INPUT_PULLDOWN: 0x3;");
  }
  lines.push("");
  
  // LED_BUILTIN if known
  if (pins["LED_BUILTIN"] !== undefined) {
    lines.push("// Built-in LED");
    lines.push(`declare const LED_BUILTIN: ${pins["LED_BUILTIN"]};`);
    lines.push("");
  }
  
  // Serial interface
  lines.push("// Serial interface");
  lines.push(SERIAL_INTERFACE);
  lines.push("declare const Serial: SerialInterface;");
  lines.push("");
  
  // Additional globals from metadata
  const extraGlobals = [...globals].filter(g => 
    !["HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "INPUT_PULLDOWN", "LED_BUILTIN", "Serial"].includes(g) &&
    !pins[g]
  );
  if (extraGlobals.length > 0) {
    lines.push("// Additional platform globals");
    for (const g of extraGlobals.sort()) {
      lines.push(`declare const ${g}: any;`);
    }
    lines.push("");
  }
  
  // Built-in functions
  lines.push("// Built-in functions");
  for (const func of ARDUINO_BUILTIN_FUNCTIONS) {
    if (functions.has(func.name)) {
      lines.push(func.signature);
    }
  }
  lines.push("");
  
  // Additional functions from metadata
  const knownFunctions = new Set(ARDUINO_BUILTIN_FUNCTIONS.map(f => f.name));
  const extraFunctions = [...functions].filter(f => !knownFunctions.has(f));
  if (extraFunctions.length > 0) {
    lines.push("// Additional platform functions");
    for (const f of extraFunctions.sort()) {
      lines.push(`declare function ${f}(...args: any[]): any;`);
    }
    lines.push("");
  }
  
  // Arduino main functions
  lines.push("// Arduino entry points");
  lines.push("declare function setup(): void;");
  lines.push("declare function loop(): void;");

  const frameworkLibraries = getFrameworkLibraries(architecture);
  if (frameworkLibraries.length > 0) {
    lines.push("");
    lines.push("// Arduino framework libraries");

    for (const library of frameworkLibraries) {
      lines.push(`// Library: ${library.name} (${library.headers.join(", ")})`);
      lines.push(...library.declarations);
      lines.push("");

      for (const module of library.modules ?? []) {
        lines.push(`declare module \"${module.name}\" {`);
        for (const exported of module.exports) {
          lines.push(`  export { ${exported} };`);
        }
        lines.push("}");
        lines.push("");
      }
    }
  }
  
  return lines.join("\n");
}

export function generateArduinoTypes(options: ArduinoTypeGeneratorOptions): ArduinoTypeGeneratorResult {
  const diagnostics: Diagnostic[] = [];
  
  const context: ArduinoPlatformContext = {
    fqbn: options.fqbn,
    architecture: options.architecture,
    arduinoCliJsonPath: options.arduinoCliJsonPath,
  };
  
  const metadataResult = loadArduinoCliMetadata(context);
  diagnostics.push(...metadataResult.diagnostics);
  
  const architecture = context.architecture ?? metadataResult.metadata?.architecture;
  
  const declarations = generateTypeDeclarations(architecture, metadataResult.metadata);
  
  // Ensure output directory exists
  const outputDir = path.dirname(options.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(options.outputPath, declarations, "utf8");
  
  return {
    outputPath: options.outputPath,
    diagnostics,
  };
}
