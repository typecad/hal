// ---------------------------------------------------------------------------
// Arduino console polyfill generator
//
// Generates Serial.println-based console polyfill helpers and Serial.begin
// injection for Arduino targets.
// ---------------------------------------------------------------------------

import type { RuntimePolyfillIR, PolyfillConfig } from "@typecode/core/shared";
import type { ProgramIR, StatementIR } from "@typecode/core/shared";

/**
 * Detect whether the user's code already calls Serial.begin (or similar).
 */
export function detectSerialBeginCall(program: ProgramIR): boolean {
  // Recursively check statements for Serial.begin calls
  const checkStatement = (stmt: StatementIR): boolean => {
    if (stmt.kind === "call") {
      // Check for Serial.begin or similar patterns
      if (stmt.callee === "Serial_begin" ||
          stmt.callee === "Serial.begin" ||
          stmt.callee.endsWith(".begin")) {
        return true;
      }
    }
    // Check nested statements in control flow
    if ("body" in stmt && Array.isArray(stmt.body)) {
      for (const nested of stmt.body) {
        if (checkStatement(nested)) return true;
      }
    }
    if ("thenBranch" in stmt && Array.isArray(stmt.thenBranch)) {
      for (const nested of stmt.thenBranch) {
        if (checkStatement(nested)) return true;
      }
    }
    if ("elseBranch" in stmt && Array.isArray(stmt.elseBranch)) {
      for (const nested of stmt.elseBranch) {
        if (checkStatement(nested)) return true;
      }
    }
    if ("cases" in stmt && Array.isArray((stmt as any).cases)) {
      for (const c of (stmt as any).cases) {
        for (const nested of c.body) {
          if (checkStatement(nested)) return true;
        }
      }
    }
    if ("tryBlock" in stmt && Array.isArray(stmt.tryBlock)) {
      for (const nested of stmt.tryBlock) {
        if (checkStatement(nested)) return true;
      }
    }
    if ("catchBlock" in stmt && Array.isArray(stmt.catchBlock)) {
      for (const nested of stmt.catchBlock) {
        if (checkStatement(nested)) return true;
      }
    }
    return false;
  };

  // Check all functions
  for (const fn of program.functions) {
    for (const stmt of fn.statements) {
      if (checkStatement(stmt)) return true;
    }
  }
  // Check top-level statements
  for (const stmt of program.topLevelStatements) {
    if (checkStatement(stmt)) return true;
  }
  // Check class methods
  for (const cls of program.classes) {
    for (const method of cls.methods) {
      for (const stmt of method.statements) {
        if (checkStatement(stmt)) return true;
      }
    }
    if (cls.constructor) {
      for (const stmt of cls.constructor.statements) {
        if (checkStatement(stmt)) return true;
      }
    }
  }
  return false;
}

/**
 * Generate Arduino-specific console polyfill using Serial.println.
 *
 * When `isArduinoStrategy` is true, the strategy (ArduinoStrategy) already
 * transforms console.log → Serial.println via `transformConsoleCall`, so
 * helper functions are omitted and only Serial.begin injection is needed.
 */
export function generateArduinoConsolePolyfill(
  methods: Set<string>,
  isAvr: boolean,
  useFlashStrings: boolean,
  baudRate: number,
  autoInject: boolean,
  usedIdentifiers?: Set<string>,
  isArduinoStrategy: boolean = false
): RuntimePolyfillIR {
  const helperFunctions: string[] = [];
  const shimMacros: string[] = [];
  const F = useFlashStrings && isAvr ? "F(" : "(";
  const F_close = useFlashStrings && isAvr ? ")" : ")";

  // For Arduino strategy, don't generate helper functions since strategy handles transformation
  // We only need Serial.begin injection
  if (!isArduinoStrategy) {
    // Generate overloaded console functions for Serial output
    if (methods.has("log")) {
      helperFunctions.push(`
// Polyfill: console.log for Arduino
inline void console_log(const char* msg) { Serial.println(msg); }
inline void console_log(int val) { Serial.println(val); }
inline void console_log(unsigned int val) { Serial.println(val); }
inline void console_log(long val) { Serial.println(val); }
inline void console_log(unsigned long val) { Serial.println(val); }
inline void console_log(float val) { Serial.println(val); }
inline void console_log(double val) { Serial.println(val); }
inline void console_log(bool val) { Serial.println(val ? "true" : "false"); }
`);
      shimMacros.push(`#define console_log(...) console_log(__VA_ARGS__)`);
    }

    if (methods.has("error")) {
      helperFunctions.push(`
// Polyfill: console.error for Arduino
inline void console_error(const char* msg) { Serial.print(${F}[ERROR]${F_close}); Serial.println(msg); }
inline void console_error(int val) { Serial.print(${F}[ERROR]${F_close}); Serial.println(val); }
inline void console_error(float val) { Serial.print(${F}[ERROR]${F_close}); Serial.println(val); }
inline void console_error(double val) { Serial.print(${F}[ERROR]${F_close}); Serial.println(val); }
`);
      shimMacros.push(`#define console_error(...) console_error(__VA_ARGS__)`);
    }

    if (methods.has("warn")) {
      helperFunctions.push(`
// Polyfill: console.warn for Arduino
inline void console_warn(const char* msg) { Serial.print(${F}[WARN]${F_close}); Serial.println(msg); }
inline void console_warn(int val) { Serial.print(${F}[WARN]${F_close}); Serial.println(val); }
inline void console_warn(float val) { Serial.print(${F}[WARN]${F_close}); Serial.println(val); }
inline void console_warn(double val) { Serial.print(${F}[WARN]${F_close}); Serial.println(val); }
`);
      shimMacros.push(`#define console_warn(...) console_warn(__VA_ARGS__)`);
    }
  }

  // Check if Serial.begin is already called in the user's code
  // (e.g. the expect preprocessor emits Serial.begin(115200) as a preamble)
  const hasSerialBegin = usedIdentifiers?.has("Serial_begin") ||
                         usedIdentifiers?.has("Serial.begin") ||
                         false;

  // Add Serial.begin helper macro for setup
  if (autoInject && !hasSerialBegin) {
    // Return setup code that will be injected into setup()
    return {
      kind: "polyfill",
      id: "console",
      domain: "arduino",
      requiredIncludes: [],
      forwardDeclarations: [],
      helperStructs: [],
      helperFunctions,
      shimMacros,
      dependencies: [],
      setupStatements: [`Serial.begin(${baudRate});`],
    };
  } else if (!hasSerialBegin) {
    shimMacros.push(`// Note: Add Serial.begin(${baudRate}); in setup() for console output`);
  }

  return {
    kind: "polyfill",
    id: "console",
    domain: "arduino",
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions,
    shimMacros,
    dependencies: [],
  };
}
