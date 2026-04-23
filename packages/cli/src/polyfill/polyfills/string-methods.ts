// ---------------------------------------------------------------------------
// String methods polyfill — detection (CLI) + generation (framework)
//
// Detection logic lives here in the CLI since it analyzes the IR.
// C++ code generation is delegated to framework packages via imported
// generator functions, since the generated C++ is platform-specific.
// ---------------------------------------------------------------------------

import type { PolyfillDefinition, PolyfillDomain, PolyfillContext, PolyfillNeed, RuntimePolyfillIR } from "../types";
import { getStdLibSupport } from "../types";
import { ProgramIR, StatementIR } from "../../ir/model";
import { generateStdStringPolyfill, generateStaticStringPolyfill } from "@typecode/framework-arduino";

export const stringMethodsPolyfill: PolyfillDefinition = {
  id: "string_methods",
  name: "String Methods",
  description: "Maps string.toUpperCase/etc to C++ equivalents",
  domains: ["standard", "arduino", "embedded"] as PolyfillDomain[],

  detect(program: ProgramIR, context: PolyfillContext): PolyfillNeed[] {
    const needs: PolyfillNeed[] = [];
    const seen = new Set<string>();
    
    for (const fn of program.functions) {
      for (const stmt of fn.statements) {
        detectStringMethodsInStatement(stmt, needs, seen);
      }
    }
    
    for (const stmt of program.topLevelStatements) {
      detectStringMethodsInStatement(stmt, needs, seen);
    }

    for (const cls of program.classes) {
      for (const method of cls.methods) {
        for (const stmt of method.statements) {
          detectStringMethodsInStatement(stmt, needs, seen);
        }
      }
    }
    
    return needs;
  },

  generate(needs: PolyfillNeed[], context: PolyfillContext): RuntimePolyfillIR {
    const methods = new Set(needs.map(n => n.details.method));
    const stdLib = getStdLibSupport(context.architecture);
    
    let impl: "std_string" | "static_string";
    
    if (context.config?.strings?.prefer && context.config.strings.prefer !== "auto") {
      impl = context.config.strings.prefer === "std_string" ? "std_string" : "static_string";
    } else {
      impl = stdLib.recommendedStringImpl;
    }

    // Delegate to framework package for C++ generation
    if (impl === "std_string") {
      return generateStdStringPolyfill(methods);
    } else {
      return generateStaticStringPolyfill(methods, context.config?.strings?.staticMaxLen ?? 64);
    }
  },
};

function detectStringMethodsInStatement(
  stmt: StatementIR,
  needs: PolyfillNeed[],
  seen: Set<string>
): void {
  if (stmt.kind === "call") {
    const callee = stmt.callee;
    const stringMethods = [
      "toUpperCase", "toLowerCase", "split", "includes", "startsWith", "endsWith",
      "trim", "substring", "slice", "indexOf", "replace", "charAt", "charCodeAt"
    ];
    
    for (const method of stringMethods) {
      if (callee.endsWith(`.${method}`) || callee.includes(`.${method}(`)) {
        const key = `string_${method}`;
        if (!seen.has(key)) {
          seen.add(key);
          needs.push({
            id: key,
            sourceSpan: stmt.sourceSpan,
            details: { method },
          });
        }
      }
    }
  }

  // Recursively check nested statements
  if (stmt.kind === "while" || stmt.kind === "do_while") {
    for (const nested of stmt.body) {
      detectStringMethodsInStatement(nested, needs, seen);
    }
  }
  if (stmt.kind === "for" || stmt.kind === "for_of" || stmt.kind === "for_in") {
    for (const nested of stmt.body) {
      detectStringMethodsInStatement(nested, needs, seen);
    }
  }
  if (stmt.kind === "if") {
    for (const nested of stmt.thenBranch) {
      detectStringMethodsInStatement(nested, needs, seen);
    }
    if (stmt.elseBranch) {
      for (const nested of stmt.elseBranch) {
        detectStringMethodsInStatement(nested, needs, seen);
      }
    }
  }
}