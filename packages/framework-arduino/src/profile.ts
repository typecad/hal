// ---------------------------------------------------------------------------
// Arduino profile resolution
//
// Resolves Arduino-specific profile settings based on FQBN and program IR.
// ---------------------------------------------------------------------------

import type { ExpressionIR, ProgramIR, StatementIR, Diagnostic, PlatformContext } from "@typecad/cuttlefish/api/shared";
import type { ArduinoPlatformContext } from "./strategy.js";

function arduinoCtx(ctx?: PlatformContext): ArduinoPlatformContext | undefined {
  const data = ctx?.frameworkData as { buildTarget?: string } | undefined;
  return data ?? undefined;
}
import type { ArduinoCliMetadata } from "./cli-metadata.js";
import { loadArduinoCliMetadata } from "./cli-metadata.js";

/**
 * Extract architecture from FQBN string.
 * FQBN format: vendor:arch:board[:menu=options]
 * e.g., "arduino:avr:uno" -> "avr"
 */
function toArchitectureFromFqbn(buildTarget?: string): string | undefined {
  if (!buildTarget) return undefined;
  const parts = buildTarget.split(":");
  return parts.length >= 2 ? parts[1] : undefined;
}

interface ArduinoProfileVariant {
  architecture: string;
  forcedIncludes: string[];
  symbolAliases?: Record<string, string>;
}

interface ArduinoCapabilities {
  architecture: string;
  builtinFunctions: Set<string>;
  builtinGlobals: Set<string>;
  fallbackPins: {
    A0?: number;
  };
}

interface FqbnPinOverride {
  fqbnIncludes: string;
  pins: {
    A0?: number;
  };
}

const PROFILE_VARIANTS: ArduinoProfileVariant[] = [
  { architecture: "avr", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "esp32", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "esp32s3", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "esp32c3", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "esp32c6", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "samd", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "rp2040", forcedIncludes: ["<Arduino.h>"] },
  { architecture: "rp2350", forcedIncludes: ["<Arduino.h>"] },
];

const DEFAULT_PROFILE: ArduinoProfileVariant = {
  architecture: "default",
  forcedIncludes: ["<Arduino.h>"],
};

const CAPABILITY_TABLE: ArduinoCapabilities[] = [
  {
    architecture: "avr",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
    builtinGlobals: new Set(["A0", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 14 },
  },
  {
    architecture: "esp32",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
    builtinGlobals: new Set(["A0", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 36 },
  },
  {
    architecture: "esp32s3",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
    builtinGlobals: new Set(["A0", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 1 },
  },
  {
    architecture: "esp32c3",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
    builtinGlobals: new Set(["A0", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 0 },
  },
  {
    architecture: "esp32c6",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
    builtinGlobals: new Set(["A0", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 0 },
  },
  {
    architecture: "samd",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
    builtinGlobals: new Set(["A0", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 14 },
  },
  {
    architecture: "rp2040",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
    builtinGlobals: new Set(["A0", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 26 },
  },
  {
    architecture: "rp2350",
    builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
    builtinGlobals: new Set(["A0", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
    fallbackPins: { A0: 26 },
  },
];

const DEFAULT_CAPABILITIES: ArduinoCapabilities = {
  architecture: "default",
  builtinFunctions: new Set(["pinMode", "digitalWrite", "analogRead", "analogReference", "delay", "millis", "micros", "setInterval", "setTimeout", "clearInterval", "clearTimeout"]),
  builtinGlobals: new Set(["A0", "INPUT", "OUTPUT", "INPUT_PULLUP", "Serial"]),
  fallbackPins: { A0: 0 },
};

const FQBN_PIN_OVERRIDES: FqbnPinOverride[] = [
  { fqbnIncludes: "arduino:avr:uno", pins: { A0: 14 } },
  { fqbnIncludes: "arduino:avr:nano", pins: { A0: 14 } },
  { fqbnIncludes: "arduino:avr:mega", pins: { A0: 54 } },
  { fqbnIncludes: "arduino:samd:mkrzero", pins: { A0: 15 } },
  { fqbnIncludes: "esp32:esp32:", pins: { A0: 36 } },
  { fqbnIncludes: "esp32:esp32s3:", pins: { A0: 1 } },
  { fqbnIncludes: "esp32:esp32c3:", pins: { A0: 0 } },
  { fqbnIncludes: "esp32:esp32c6:", pins: { A0: 0 } },
  { fqbnIncludes: "rp2040:rp2040:", pins: { A0: 26 } },
  { fqbnIncludes: "rp2350:rp2350:", pins: { A0: 26 } },
];

export interface ResolvedArduinoProfile {
  forcedIncludes: string[];
  symbolAliases: Record<string, string>;
  shimLines: string[];
  diagnostics: Diagnostic[];
}

function walkStatements(statements: StatementIR[], onStatement: (statement: StatementIR) => void): void {
  for (const statement of statements) {
    onStatement(statement);
    if (statement.kind === "while") {
      walkStatements(statement.body, onStatement);
    } else if (statement.kind === "do_while") {
      walkStatements(statement.body, onStatement);
    } else if (statement.kind === "if") {
      walkStatements(statement.thenBranch, onStatement);
      if (statement.elseBranch) walkStatements(statement.elseBranch, onStatement);
    } else if (statement.kind === "for") {
      if (statement.body) walkStatements(statement.body, onStatement);
    } else if (statement.kind === "for_of" || statement.kind === "for_in") {
      if (statement.body) walkStatements(statement.body, onStatement);
    } else if (statement.kind === "try") {
      walkStatements(statement.tryBlock, onStatement);
      if (statement.catchBlock) walkStatements(statement.catchBlock, onStatement);
      if (statement.finallyBlock) walkStatements(statement.finallyBlock, onStatement);
    } else if (statement.kind === "block") {
      walkStatements(statement.body ?? [], onStatement);
    }
  }
}

function collectUsedIdentifiers(program: ProgramIR): Set<string> {
  const used = new Set<string>();

  function collectExpression(expr?: ExpressionIR): void {
    if (!expr) {
      return;
    }

    if (expr.kind === "identifier") {
      used.add(expr.value);
      return;
    }

    if (expr.kind === "raw") {
      for (const token of expr.value.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
        used.add(token);
      }
    }
  }

  const collectFromStatement = (statement: StatementIR): void => {
    if (statement.kind === "call") {
      if (statement.callee === "__EMIT__") {
        for (const arg of statement.args) {
          if (arg.kind === "string") {
            for (const token of arg.value.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
              used.add(token);
            }
          }
        }
      } else {
        const root = statement.callee.split(".")[0];
        if (root) {
          used.add(root);
        }
        for (const arg of statement.args) {
          collectExpression(arg);
        }
      }
      return;
    }

    if (statement.kind === "assign") {
      used.add(statement.target);
      collectExpression(statement.value);
      return;
    }

    if (statement.kind === "update") {
      used.add(statement.target);
      return;
    }

    if (statement.kind === "var_decl") {
      collectExpression(statement.initializer);
      return;
    }

    if (statement.kind === "return") {
      collectExpression(statement.value);
      return;
    }

    if (statement.kind === "hal-op") {
      // HAL ops carry raw C++ code (e.g. the Preferences namespace lowers to
      // `Preferences.begin(...)` inside a hal-op). Scan it for identifiers so
      // namespace-detection shims (Preferences/EEPROM/etc.) fire. Without this,
      // `used` never sees "Preferences" and the AVR Preferences shim is dropped
      // (avr-g++: "'Preferences' was not declared in this scope"). Demo #33.
      const op = statement.operation;
      if (op && op.operation === "raw" && typeof op.code === "string") {
        for (const token of op.code.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
          used.add(token);
        }
      }
      // Typed preferences.* ops replaced the rawCpp path. Map them back to the
      // "Preferences" namespace identifier so the per-arch shim (AVR EEPROM /
      // ESP32 <Preferences.h>) still fires from needsPreferences below.
      if (op && typeof op.operation === "string" && op.operation.startsWith("preferences.")) {
        used.add("Preferences");
      }
      return;
    }

    if (statement.kind === "while") {
      collectExpression(statement.condition);
    }
  };

  walkStatements(program.topLevelStatements, collectFromStatement);
  for (const fn of program.functions) {
    walkStatements(fn.statements, collectFromStatement);
  }

  return used;
}

function collectCalledFunctions(program: ProgramIR): Set<string> {
  const called = new Set<string>();

  const collectFromStatement = (statement: StatementIR): void => {
    if (statement.kind === "call") {
      // Exclude method calls (both . and -> syntax) from built-in function checking
      if (!statement.callee.includes(".") && !statement.callee.includes("->")) {
        called.add(statement.callee);
      }
      return;
    }

    if (statement.kind === "while") {
      return;
    }
  };

  walkStatements(program.topLevelStatements, collectFromStatement);
  for (const fn of program.functions) {
    walkStatements(fn.statements, collectFromStatement);
  }

  return called;
}

function collectTopLevelDeclarations(program: ProgramIR): Set<string> {
  const declared = new Set<string>();
  for (const statement of program.topLevelStatements) {
    if (statement.kind === "var_decl") {
      declared.add(statement.name);
    }
  }

  for (const fn of program.functions) {
    declared.add(fn.originalName);
  }

  return declared;
}

function resolveVariant(context?: ArduinoPlatformContext): ArduinoProfileVariant {
  const architecture = toArchitectureFromFqbn(context?.buildTarget);
  if (!architecture) {
    return DEFAULT_PROFILE;
  }

  return PROFILE_VARIANTS.find((item) => item.architecture === architecture) ?? DEFAULT_PROFILE;
}

function resolveCapabilities(context?: ArduinoPlatformContext): ArduinoCapabilities {
  const architecture = toArchitectureFromFqbn(context?.buildTarget);
  if (!architecture) {
    return DEFAULT_CAPABILITIES;
  }

  return CAPABILITY_TABLE.find((item) => item.architecture === architecture) ?? DEFAULT_CAPABILITIES;
}

function mergeCapabilities(base: ArduinoCapabilities, metadata?: ArduinoCliMetadata): ArduinoCapabilities {
  if (!metadata) {
    return base;
  }

  return {
    architecture: metadata.architecture ?? base.architecture,
    builtinFunctions: new Set<string>([...base.builtinFunctions, ...metadata.builtinFunctions]),
    builtinGlobals: new Set<string>([...base.builtinGlobals, ...metadata.builtinGlobals]),
    fallbackPins: {
      A0: metadata.pins.A0 ?? base.fallbackPins.A0,
    },
  };
}

function resolveA0Fallback(
  context: ArduinoPlatformContext | undefined,
  capabilities: ArduinoCapabilities,
  metadata?: ArduinoCliMetadata,
): number {
  if (metadata?.pins.A0 !== undefined) {
    return metadata.pins.A0;
  }

  const buildTarget = context?.buildTarget?.toLowerCase() ?? "";
  if (buildTarget) {
    const override = FQBN_PIN_OVERRIDES.find((item) => buildTarget.includes(item.fqbnIncludes.toLowerCase()));
    if (override?.pins.A0 !== undefined) {
      return override.pins.A0;
    }
  }

  return capabilities.fallbackPins.A0 ?? 0;
}

// ---------------------------------------------------------------------------
// AVR EEPROM-backed Preferences shim
//
// Injected as raw C++ when the program uses the Preferences namespace on a
// non-ESP32 target.  Slot layout (16 bytes each):
//   Byte 0:     magic (0xA5 = occupied)
//   Byte 1:     type tag (_T_I32/_T_U32/_T_BOOL/_T_FLT/_T_STR)
//   Bytes 2-5:  32-bit DJB hash of key (little-endian)
//   Bytes 6-15: value (10 bytes — int32, uint32, bool, float, strings ≤9 chars)
//
// 32 slots × 16 bytes = 512 bytes of EEPROM.
// ---------------------------------------------------------------------------

const AVR_PREFERENCES_SHIM: string[] = [
  'class __tc_Preferences {',
  '  static const int _SLOT_COUNT = 32;',
  '  static const int _SLOT_SIZE  = 16;',
  '  static const int _BASE_ADDR  = 0;',
  '  static const uint8_t _MAGIC  = 0xA5;',
  '  static const uint8_t _T_I32  = 0x01;',
  '  static const uint8_t _T_U32  = 0x02;',
  '  static const uint8_t _T_BOOL = 0x03;',
  '  static const uint8_t _T_FLT  = 0x04;',
  '  static const uint8_t _T_STR  = 0x05;',
  '  bool _started;',
  '  static uint32_t _djbHash(const char* s) {',
  '    uint32_t h = 5381;',
  '    while (*s) { h = ((h << 5) + h) + static_cast<uint8_t>(*s); s++; }',
  '    return h;',
  '  }',
  '  int _findSlot(const char* key, uint8_t typeTag) {',
  '    uint32_t h = _djbHash(key);',
  '    int start = static_cast<int>(h % static_cast<uint32_t>(_SLOT_COUNT));',
  '    for (int i = 0; i < _SLOT_COUNT; i++) {',
  '      int idx = (start + i) % _SLOT_COUNT;',
  '      int addr = _BASE_ADDR + idx * _SLOT_SIZE;',
  '      if (EEPROM.read(addr) != _MAGIC) return -1;',
  '      if (EEPROM.read(addr + 1) != typeTag) continue;',
  '      uint32_t stored = static_cast<uint32_t>(EEPROM.read(addr+2))',
  '        | (static_cast<uint32_t>(EEPROM.read(addr+3)) << 8)',
  '        | (static_cast<uint32_t>(EEPROM.read(addr+4)) << 16)',
  '        | (static_cast<uint32_t>(EEPROM.read(addr+5)) << 24);',
  '      if (stored == h) return idx;',
  '    }',
  '    return -1;',
  '  }',
  '  int _findSlotForWrite(const char* key, uint8_t typeTag) {',
  '    uint32_t h = _djbHash(key);',
  '    int start = static_cast<int>(h % static_cast<uint32_t>(_SLOT_COUNT));',
  '    int firstEmpty = -1;',
  '    for (int i = 0; i < _SLOT_COUNT; i++) {',
  '      int idx = (start + i) % _SLOT_COUNT;',
  '      int addr = _BASE_ADDR + idx * _SLOT_SIZE;',
  '      if (EEPROM.read(addr) != _MAGIC) {',
  '        if (firstEmpty < 0) firstEmpty = idx;',
  '        continue;',
  '      }',
  '      if (EEPROM.read(addr + 1) != typeTag) continue;',
  '      uint32_t stored = static_cast<uint32_t>(EEPROM.read(addr+2))',
  '        | (static_cast<uint32_t>(EEPROM.read(addr+3)) << 8)',
  '        | (static_cast<uint32_t>(EEPROM.read(addr+4)) << 16)',
  '        | (static_cast<uint32_t>(EEPROM.read(addr+5)) << 24);',
  '      if (stored == h) return idx;',
  '    }',
  '    return firstEmpty;',
  '  }',
  '  void _writeHeader(int addr, uint32_t hash, uint8_t typeTag) {',
  '    EEPROM.update(addr, _MAGIC);',
  '    EEPROM.update(addr + 1, typeTag);',
  '    EEPROM.update(addr + 2, static_cast<uint8_t>(hash & 0xFF));',
  '    EEPROM.update(addr + 3, static_cast<uint8_t>((hash >> 8) & 0xFF));',
  '    EEPROM.update(addr + 4, static_cast<uint8_t>((hash >> 16) & 0xFF));',
  '    EEPROM.update(addr + 5, static_cast<uint8_t>((hash >> 24) & 0xFF));',
  '  }',
  'public:',
  '  __tc_Preferences() : _started(false) {}',
  '  void begin(const char* ns, bool readOnly = false) { _started = true; }',
  '  void end() { _started = false; }',
  '  size_t putInt(const char* key, int32_t value) {',
    '    if (!_started) return 0;',
  '    uint32_t h = _djbHash(key);',
  '    int idx = _findSlotForWrite(key, _T_I32);',
  '    if (idx < 0) return 0;',
  '    int addr = _BASE_ADDR + idx * _SLOT_SIZE + 6;',
  '    _writeHeader(addr - 6, h, _T_I32);',
  '    EEPROM.update(addr,     static_cast<uint8_t>(value & 0xFF));',
  '    EEPROM.update(addr + 1, static_cast<uint8_t>((value >> 8) & 0xFF));',
  '    EEPROM.update(addr + 2, static_cast<uint8_t>((value >> 16) & 0xFF));',
  '    EEPROM.update(addr + 3, static_cast<uint8_t>((value >> 24) & 0xFF));',
  '    return 4;',
  '  }',
  '  int32_t getInt(const char* key, int32_t defaultValue) {',
  '    if (!_started) return defaultValue;',
  '    int idx = _findSlot(key, _T_I32);',
  '    if (idx < 0) return defaultValue;',
  '    int addr = _BASE_ADDR + idx * _SLOT_SIZE + 6;',
  '    return static_cast<int32_t>(static_cast<uint32_t>(EEPROM.read(addr))',
  '      | (static_cast<uint32_t>(EEPROM.read(addr+1)) << 8)',
  '      | (static_cast<uint32_t>(EEPROM.read(addr+2)) << 16)',
  '      | (static_cast<uint32_t>(EEPROM.read(addr+3)) << 24));',
  '  }',
  '  size_t putUInt(const char* key, uint32_t value) {',
  '    if (!_started) return 0;',
  '    uint32_t h = _djbHash(key);',
  '    int idx = _findSlotForWrite(key, _T_U32);',
  '    if (idx < 0) return 0;',
  '    int addr = _BASE_ADDR + idx * _SLOT_SIZE + 6;',
  '    _writeHeader(addr - 6, h, _T_U32);',
  '    EEPROM.update(addr,     static_cast<uint8_t>(value & 0xFF));',
  '    EEPROM.update(addr + 1, static_cast<uint8_t>((value >> 8) & 0xFF));',
  '    EEPROM.update(addr + 2, static_cast<uint8_t>((value >> 16) & 0xFF));',
  '    EEPROM.update(addr + 3, static_cast<uint8_t>((value >> 24) & 0xFF));',
  '    return 4;',
  '  }',
  '  uint32_t getUInt(const char* key, uint32_t defaultValue) {',
  '    if (!_started) return defaultValue;',
  '    int idx = _findSlot(key, _T_U32);',
  '    if (idx < 0) return defaultValue;',
  '    int addr = _BASE_ADDR + idx * _SLOT_SIZE + 6;',
  '    return static_cast<uint32_t>(EEPROM.read(addr))',
  '      | (static_cast<uint32_t>(EEPROM.read(addr+1)) << 8)',
  '      | (static_cast<uint32_t>(EEPROM.read(addr+2)) << 16)',
  '      | (static_cast<uint32_t>(EEPROM.read(addr+3)) << 24);',
  '  }',
  '  size_t putBool(const char* key, bool value) {',
  '    if (!_started) return 0;',
  '    uint32_t h = _djbHash(key);',
  '    int idx = _findSlotForWrite(key, _T_BOOL);',
  '    if (idx < 0) return 0;',
  '    int addr = _BASE_ADDR + idx * _SLOT_SIZE + 6;',
  '    _writeHeader(addr - 6, h, _T_BOOL);',
  '    EEPROM.update(addr, value ? 1 : 0);',
  '    return 1;',
  '  }',
  '  bool getBool(const char* key, bool defaultValue) {',
  '    if (!_started) return defaultValue;',
  '    int idx = _findSlot(key, _T_BOOL);',
  '    if (idx < 0) return defaultValue;',
  '    return EEPROM.read(_BASE_ADDR + idx * _SLOT_SIZE + 6) != 0;',
  '  }',
  '  size_t putFloat(const char* key, float value) {',
  '    if (!_started) return 0;',
  '    uint32_t h = _djbHash(key);',
  '    int idx = _findSlotForWrite(key, _T_FLT);',
  '    if (idx < 0) return 0;',
  '    int addr = _BASE_ADDR + idx * _SLOT_SIZE + 6;',
  '    _writeHeader(addr - 6, h, _T_FLT);',
  '    uint8_t* pb = (uint8_t*)&value;',
  '    for (int i = 0; i < 4; i++) EEPROM.update(addr + i, pb[i]);',
  '    return 4;',
  '  }',
  '  float getFloat(const char* key, float defaultValue) {',
  '    if (!_started) return defaultValue;',
  '    int idx = _findSlot(key, _T_FLT);',
  '    if (idx < 0) return defaultValue;',
  '    int addr = _BASE_ADDR + idx * _SLOT_SIZE + 6;',
  '    float v; uint8_t* pb = (uint8_t*)&v;',
  '    for (int i = 0; i < 4; i++) pb[i] = EEPROM.read(addr + i);',
  '    return v;',
  '  }',
  '  size_t putString(const char* key, const char* value) {',
  '    if (!_started) return 0;',
  '    uint32_t h = _djbHash(key);',
  '    int idx = _findSlotForWrite(key, _T_STR);',
  '    if (idx < 0) return 0;',
  '    int addr = _BASE_ADDR + idx * _SLOT_SIZE + 6;',
  '    _writeHeader(addr - 6, h, _T_STR);',
  '    int vLen = static_cast<int>(strlen(value));',
  '    if (vLen > 9) vLen = 9;',
  '    for (int i = 0; i < vLen; i++) EEPROM.update(addr + i, static_cast<uint8_t>(value[i]));',
  '    EEPROM.update(addr + vLen, 0);',
  '    return static_cast<size_t>(vLen);',
  '  }',
  '  const char* getString(const char* key, const char* defaultValue) {',
  '    if (!_started) return defaultValue;',
  '    int idx = _findSlot(key, _T_STR);',
  '    if (idx < 0) return defaultValue;',
  '    int addr = _BASE_ADDR + idx * _SLOT_SIZE + 6;',
  '    static char result[11];',
  '    for (int i = 0; i < 10; i++) {',
  '      char c = static_cast<char>(EEPROM.read(addr + i));',
  '      result[i] = c;',
  '      if (c == 0) break;',
  '    }',
  '    result[10] = 0;',
  '    return result;',
  '  }',
  '  bool clear() {',
  '    for (int i = 0; i < _SLOT_COUNT; i++)',
  '      EEPROM.update(_BASE_ADDR + i * _SLOT_SIZE, 0xFF);',
  '    return true;',
  '  }',
  '  bool remove(const char* key) {',
  '    if (!_started) return false;',
  '    uint8_t tags[] = {_T_I32, _T_U32, _T_BOOL, _T_FLT, _T_STR};',
  '    for (int t = 0; t < 5; t++) {',
  '      int idx = _findSlot(key, tags[t]);',
  '      if (idx >= 0) { EEPROM.update(_BASE_ADDR + idx * _SLOT_SIZE, 0xFF); return true; }',
  '    }',
  '    return false;',
  '  }',
  '};',
];

export function resolveArduinoProfile(program: ProgramIR, platformContext?: PlatformContext): ResolvedArduinoProfile {
  const context = arduinoCtx(platformContext);
  const metadataResult = loadArduinoCliMetadata(context);
  const variant = resolveVariant(context);
  const capabilities = mergeCapabilities(resolveCapabilities(context), metadataResult.metadata);

  const diagnostics: Diagnostic[] = [...metadataResult.diagnostics];

  const used = collectUsedIdentifiers(program);
  const calledFunctions = collectCalledFunctions(program);
  const declared = collectTopLevelDeclarations(program);
  const shimLines: string[] = [];

  for (const functionName of calledFunctions) {
    if (declared.has(functionName)) {
      continue;
    }

    // Skip internal transpiler functions and runtime helpers
    if (functionName === "__EMIT__" || functionName === "__EXPR_STMT__" || functionName.startsWith("__RAW_STMT__") || functionName.startsWith("__tc_")) {
      continue;
    }

    if (!capabilities.builtinFunctions.has(functionName)) {
      diagnostics.push({
        severity: "warning",
        code: "TypeCAD_ARDUINO_FUNC_UNKNOWN",
        message: `Function '${functionName}' is not in the known Arduino built-in function set for architecture '${capabilities.architecture}'.`,
      });
    }
  }

  for (const identifier of used) {
    if (declared.has(identifier)) {
      continue;
    }

    if (
      identifier === "HIGH" ||
      identifier === "LOW" ||
      identifier === "A0" ||
      identifier === "INPUT" ||
      identifier === "OUTPUT" ||
      identifier === "INPUT_PULLUP" ||
      identifier === "Serial"
    ) {
      if (!capabilities.builtinGlobals.has(identifier)) {
        diagnostics.push({
          severity: "warning",
          code: "TypeCAD_ARDUINO_GLOBAL_UNKNOWN",
          message: `Global '${identifier}' is not in the known Arduino built-in set for architecture '${capabilities.architecture}'.`,
        });
      }
    }
  }

  const needsHigh = used.has("HIGH") && !declared.has("HIGH") && !capabilities.builtinGlobals.has("HIGH");
  const needsLow = used.has("LOW") && !declared.has("LOW") && !capabilities.builtinGlobals.has("LOW");
  const needsA0 = used.has("A0") && !declared.has("A0") && !capabilities.builtinGlobals.has("A0");

  if (needsHigh) {
    shimLines.push("#ifndef HIGH", "#define HIGH 0x1", "#endif");
    diagnostics.push({
      severity: "warning",
      code: "TypeCAD_ARDUINO_SHIM_HIGH",
      message: "Injected fallback HIGH shim. Verify platform-specific value if your core overrides it.",
    });
  }

  if (needsLow) {
    shimLines.push("#ifndef LOW", "#define LOW 0x0", "#endif");
    diagnostics.push({
      severity: "warning",
      code: "TypeCAD_ARDUINO_SHIM_LOW",
      message: "Injected fallback LOW shim. Verify platform-specific value if your core overrides it.",
    });
  }

  if (needsA0) {
    const a0Fallback = resolveA0Fallback(context, capabilities, metadataResult.metadata);
    shimLines.push("#ifndef A0", `#define A0 ${a0Fallback}`, "#endif");
    diagnostics.push({
      severity: "warning",
      code: "TypeCAD_ARDUINO_SHIM_A0",
      message: `Injected fallback A0 shim as '${a0Fallback}'. Board-specific analog pin mapping may differ; set --fqbn for accurate pin mapping.`,
    });
  }

  const extraIncludes: string[] = [];

  if (used.has('DAC1') || used.has('DAC2')) {
    const arch = toArchitectureFromFqbn(context?.buildTarget);
    if (arch === 'esp32') {
      extraIncludes.push('<driver/dac.h>');
    }
  }

  // `<avr/wdt.h>` is no longer forced here. It is added on demand by the
  // cuttlefish setup emitter when the generated output actually references
  // wdt_enable/wdt_reset/wdt_disable (the HAL resolver lowers WDT.* calls to
  // those). Forcing it here leaked the include into every AVR program — even
  // trivial ones like `led.toggle()` — and making it program-dependent here
  // would conflict with the profile cache (keyed on buildTarget only).
  const needsPreferences = used.has("Preferences") && !declared.has("Preferences");
  if (needsPreferences) {
    const arch = toArchitectureFromFqbn(context?.buildTarget);
    if (arch === 'avr' || arch === 'megaavr' || arch === 'default') {
      shimLines.push(...AVR_PREFERENCES_SHIM);
      shimLines.push("static __tc_Preferences Preferences;");
      extraIncludes.push('<EEPROM.h>');
    } else if (arch === 'esp32') {
      shimLines.push(
        "#include <Preferences.h>",
        "struct __tc_Esp32Prefs : public Preferences {",
        "  const char* getString(const char* key, const char* defaultValue = \"\") {",
        "    static char _buf[64];",
        "    if (Preferences::getString(key, _buf, sizeof(_buf))) return _buf;",
        "    return defaultValue;",
        "  }",
        "};",
        "static __tc_Esp32Prefs __tc_prefs;",
        "#define Preferences __tc_prefs"
      );
    }
  }

  return {
    forcedIncludes: [...variant.forcedIncludes, ...extraIncludes],
    symbolAliases: {
      ...(variant.symbolAliases ?? {}),
    },
    shimLines,
    diagnostics,
  };
}