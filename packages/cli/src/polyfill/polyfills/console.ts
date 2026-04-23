// ---------------------------------------------------------------------------
// Console polyfill — detection (CLI) + generation (framework)
//
// Detection logic lives here in the CLI since it analyzes the IR.
// C++ code generation is delegated to framework packages via imported
// generator functions, since the generated C++ is platform-specific.
// ---------------------------------------------------------------------------

import type { PolyfillDefinition, PolyfillDomain, PolyfillContext, PolyfillNeed, RuntimePolyfillIR } from "../types";
import { ProgramIR, StatementIR } from "../../ir/model";
import { generateArduinoConsolePolyfill, generateGenericConsolePolyfill } from "@typecode/framework-arduino";

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

    // Delegate to framework package for C++ generation
    if (impl === "serial") {
      const baudRate = context.config?.console?.baudRate ?? 9600;
      const autoInject = context.config?.console?.autoInjectSerialBegin ?? true;
      return generateArduinoConsolePolyfill(methods, isAvr, context.config?.console?.useFlashStrings ?? true, baudRate, autoInject, context.usedIdentifiers, isArduino);
    } else {
      return generateGenericConsolePolyfill(methods);
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