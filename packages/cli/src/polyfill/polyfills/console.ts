import { PolyfillDefinition, PolyfillContext, PolyfillNeed, RuntimePolyfillIR, getStdLibSupport } from "../types";
import { ProgramIR, StatementIR } from "../../ir/model";
import { generateArduinoConsolePolyfill } from "@typecode/framework-arduino";

export const consolePolyfill: PolyfillDefinition = {
  id: "console",
  name: "Console Output",
  description: "Maps console.log/error/warn to appropriate output stream",
  domains: ["standard", "arduino", "embedded"],

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
    
    // For Arduino, the strategy (ArduinoStrategy) already transforms console.log to Serial.println
    // via transformConsoleCall, so we don't need the polyfill helper functions.
    // We only need the polyfill for Serial.begin injection.
    // The polyfill still returns empty helpers since the strategy handles the transformation.
    
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
      // For Arduino, return empty helper functions since strategy handles transformation
      // Only need to inject Serial.begin in setup
      return generateArduinoConsolePolyfill(methods, isAvr, context.config?.console?.useFlashStrings ?? true, baudRate, autoInject, context.usedIdentifiers, isArduino);
    } else {
      return generateStdConsolePolyfill(methods);
    }
  },
};

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

function generateStdConsolePolyfill(methods: Set<string>): RuntimePolyfillIR {
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