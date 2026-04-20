// ---------------------------------------------------------------------------
// Array methods polyfill — detection (CLI) + generation (framework)
//
// Detection logic lives here in the CLI since it analyzes the IR.
// C++ code generation is delegated to framework packages via imported
// generator functions, since the generated C++ is platform-specific.
// ---------------------------------------------------------------------------

import { PolyfillDefinition, PolyfillContext, PolyfillNeed, RuntimePolyfillIR, getStdLibSupport } from "../types";
import { ProgramIR, StatementIR } from "../../ir/model";
import {
  generateStdVectorArrayPolyfill,
  generateStaticArrayPolyfill,
} from "@typecode/framework-arduino";

export const arrayMethodsPolyfill: PolyfillDefinition = {
  id: "array_methods",
  name: "Array Methods",
  description: "Maps array.push/pop/etc to C++ equivalents",
  domains: ["standard", "arduino", "embedded"],

  detect(program: ProgramIR, context: PolyfillContext): PolyfillNeed[] {
    const needs: PolyfillNeed[] = [];
    const seen = new Set<string>();
    
    // Look for array method calls like arr.push(), arr.pop(), arr.length
    for (const fn of program.functions) {
      for (const stmt of fn.statements) {
        detectArrayMethodsInStatement(stmt, needs, seen);
      }
    }
    
    for (const stmt of program.topLevelStatements) {
      detectArrayMethodsInStatement(stmt, needs, seen);
    }

    for (const cls of program.classes) {
      for (const method of cls.methods) {
        for (const stmt of method.statements) {
          detectArrayMethodsInStatement(stmt, needs, seen);
        }
      }
    }
    
    return needs;
  },

  generate(needs: PolyfillNeed[], context: PolyfillContext): RuntimePolyfillIR {
    const methods = new Set(needs.map(n => n.details.method));
    const stdLib = getStdLibSupport(context.architecture);
    
    // Determine implementation type
    let impl: "std_vector" | "static_array";
    
    if (context.config?.arrays?.prefer && context.config.arrays.prefer !== "auto") {
      impl = context.config.arrays.prefer === "std_vector" ? "std_vector" : "static_array";
    } else {
      impl = stdLib.recommendedArrayImpl;
    }

    // Delegate to framework package for C++ generation
    if (impl === "std_vector") {
      return generateStdVectorArrayPolyfill(methods);
    } else {
      return generateStaticArrayPolyfill(methods, context.config?.arrays?.staticMaxSize ?? 32);
    }
  },
};

function detectArrayMethodsInStatement(
  stmt: StatementIR,
  needs: PolyfillNeed[],
  seen: Set<string>
): void {
  if (stmt.kind === "call") {
    // Check for array methods: .push, .pop, .shift, .unshift, etc.
    const callee = stmt.callee;
    const arrayMethods = ["push", "pop", "push_back", "pop_back", "indexOf", "shift", "unshift", "length", "map", "filter", "forEach"];
    
    for (const method of arrayMethods) {
      if (callee.endsWith(`.${method}`) || callee.includes(`.${method}(`)) {
        const key = `array_${method}`;
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
      detectArrayMethodsInStatement(nested, needs, seen);
    }
  }
  if (stmt.kind === "for" || stmt.kind === "for_of" || stmt.kind === "for_in") {
    for (const nested of stmt.body) {
      detectArrayMethodsInStatement(nested, needs, seen);
    }
  }
  if (stmt.kind === "if") {
    for (const nested of stmt.thenBranch) {
      detectArrayMethodsInStatement(nested, needs, seen);
    }
    if (stmt.elseBranch) {
      for (const nested of stmt.elseBranch) {
        detectArrayMethodsInStatement(nested, needs, seen);
      }
    }
  }
  if (stmt.kind === "switch") {
    for (const caseClause of stmt.cases) {
      for (const nested of caseClause.body) {
        detectArrayMethodsInStatement(nested, needs, seen);
      }
    }
  }
  if (stmt.kind === "try") {
    for (const nested of stmt.tryBlock) {
      detectArrayMethodsInStatement(nested, needs, seen);
    }
    if (stmt.catchBlock) {
      for (const nested of stmt.catchBlock) {
        detectArrayMethodsInStatement(nested, needs, seen);
      }
    }
  }
}