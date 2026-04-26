// ---------------------------------------------------------------------------
// Console polyfill — detection + generation
//
// Detection analyzes the IR for console.* calls.
// C++ code generation produces Serial.println (Arduino) or std::cout (generic)
// polyfill helpers. All logic lives in the CLI; no framework package dependency.
// ---------------------------------------------------------------------------

import type { PolyfillDefinition, PolyfillDomain, PolyfillContext, PolyfillNeed, RuntimePolyfillIR } from "../types";
import { ProgramIR, StatementIR } from "../../ir/model";

// ---------------------------------------------------------------------------
// Polyfill definition
// ---------------------------------------------------------------------------

export const consolePolyfill: PolyfillDefinition = {
  id: "console",
  name: "Console Output",
  description: "Maps console.log/error/warn to appropriate output stream",
  domains: ["standard", "arduino", "embedded"] as PolyfillDomain[],

  detect(program: ProgramIR, context: PolyfillContext): PolyfillNeed[] {
    const needs: PolyfillNeed[] = [];
    const seen = new Set<string>();

    // Walk all call expressions looking for console.*
    for (const fn of program.functions) {
      for (const stmt of fn.statements) {
        const needsFromStmt = detectConsoleInStatement(stmt);
        for (const need of needsFromStmt) {
          if (!seen.has(need.id)) {
            seen.add(need.id);
            needs.push(need);
          }
        }
      }
    }

    // Also check top-level statements
    for (const stmt of program.topLevelStatements) {
      const needsFromStmt = detectConsoleInStatement(stmt);
      for (const need of needsFromStmt) {
        if (!seen.has(need.id)) {
          seen.add(need.id);
          needs.push(need);
        }
      }
    }

    // Check class methods
    for (const cls of program.classes) {
      for (const method of cls.methods) {
        for (const stmt of method.statements) {
          const needsFromStmt = detectConsoleInStatement(stmt);
          for (const need of needsFromStmt) {
            if (!seen.has(need.id)) {
              seen.add(need.id);
              needs.push(need);
            }
          }
        }
      }
      if (cls.constructor) {
        for (const stmt of cls.constructor.statements) {
          const needsFromStmt = detectConsoleInStatement(stmt);
          for (const need of needsFromStmt) {
            if (!seen.has(need.id)) {
              seen.add(need.id);
              needs.push(need);
            }
          }
        }
      }
    }

    return needs;
  },

  generate(needs: PolyfillNeed[], context: PolyfillContext): RuntimePolyfillIR {
    const methods = new Set(needs.map(n => n.details.method));
    const isArduino = context.target === "arduino";
    const isAvr = context.architecture === "avr" || context.architecture === "megaavr";
    
    // Determine which implementation to use
    let impl: "serial" | "cout";
    
    if (context.config?.console?.target && context.config.console.target !== "auto") {
      impl = context.config.console.target === "serial" ? "serial" : "cout";
    } else {
      impl = isArduino ? "serial" : "cout";
    }

    if (impl === "serial") {
      const baudRate = context.config?.console?.baudRate ?? 9600;
      const autoInject = context.config?.console?.autoInjectSerialBegin ?? true;
      return generateArduinoConsolePolyfill(methods, isAvr, context.config?.console?.useFlashStrings ?? true, baudRate, autoInject, context.usedIdentifiers, isArduino);
    } else {
      return generateGenericConsolePolyfill(methods);
    }
  },
};

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function detectConsoleInStatement(stmt: StatementIR): PolyfillNeed[] {
  const needs: PolyfillNeed[] = [];

  if (stmt.kind === "call" && stmt.callee.startsWith("console.")) {
    const method = stmt.callee.split(".")[1];
    needs.push({
      id: stmt.callee,
      sourceSpan: stmt.sourceSpan,
      details: {
        method,
        argCount: stmt.args.length,
      },
    });
  }

  // Recursively check nested statements in control flow
  if (stmt.kind === "while" || stmt.kind === "do_while") {
    for (const nested of stmt.body) {
      needs.push(...detectConsoleInStatement(nested));
    }
  }
  if (stmt.kind === "for" || stmt.kind === "for_of" || stmt.kind === "for_in") {
    for (const nested of stmt.body) {
      needs.push(...detectConsoleInStatement(nested));
    }
  }
  if (stmt.kind === "if") {
    for (const nested of stmt.thenBranch) {
      needs.push(...detectConsoleInStatement(nested));
    }
    if (stmt.elseBranch) {
      for (const nested of stmt.elseBranch) {
        needs.push(...detectConsoleInStatement(nested));
      }
    }
  }
  if (stmt.kind === "switch") {
    for (const caseClause of stmt.cases) {
      for (const nested of caseClause.body) {
        needs.push(...detectConsoleInStatement(nested));
      }
    }
  }
  if (stmt.kind === "try") {
    for (const nested of stmt.tryBlock) {
      needs.push(...detectConsoleInStatement(nested));
    }
    if (stmt.catchBlock) {
      for (const nested of stmt.catchBlock) {
        needs.push(...detectConsoleInStatement(nested));
      }
    }
  }

  return needs;
}

// ---------------------------------------------------------------------------
// Arduino console polyfill generator (Serial.println-based)
// ---------------------------------------------------------------------------

/**
 * Generate Arduino-specific console polyfill using Serial.println.
 *
 * When `isArduinoStrategy` is true, the strategy (ArduinoStrategy) already
 * transforms console.log → Serial.println via `transformConsoleCall`, so
 * helper functions are omitted and only Serial.begin injection is needed.
 */
function generateArduinoConsolePolyfill(
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

// ---------------------------------------------------------------------------
// Generic console polyfill generator (std::cout-based)
// ---------------------------------------------------------------------------

/**
 * Generate generic console polyfill using std::cout/std::cerr.
 * Used as the fallback for non-Arduino targets (generic C++ output).
 */
function generateGenericConsolePolyfill(methods: Set<string>): RuntimePolyfillIR {
  const helperFunctions: string[] = [];
  const shimMacros: string[] = [];

  if (methods.has("log")) {
    helperFunctions.push(`
// Polyfill: console.log using std::cout
#include <iostream>
template<typename T>
inline void console_log(const T& val) { std::cout << val << std::endl; }
`);
    shimMacros.push(`#define console_log(...) console_log(__VA_ARGS__)`);
  }

  if (methods.has("error")) {
    helperFunctions.push(`
// Polyfill: console.error using std::cerr
template<typename T>
inline void console_error(const T& val) { std::cerr << "[ERROR] " << val << std::endl; }
`);
    shimMacros.push(`#define console_error(...) console_error(__VA_ARGS__)`);
  }

  if (methods.has("warn")) {
    helperFunctions.push(`
// Polyfill: console.warn using std::cerr
template<typename T>
inline void console_warn(const T& val) { std::cerr << "[WARN] " << val << std::endl; }
`);
    shimMacros.push(`#define console_warn(...) console_warn(__VA_ARGS__)`);
  }

  return {
    kind: "polyfill",
    id: "console",
    domain: "standard",
    requiredIncludes: ["<iostream>"],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions,
    shimMacros,
    dependencies: [],
  };
}
