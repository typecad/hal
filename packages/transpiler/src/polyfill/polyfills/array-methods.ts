// ---------------------------------------------------------------------------
// Array methods polyfill — detection + generation
//
// Detection logic analyzes the IR for array method calls.
// C++ code generation produces std::vector or StaticArray polyfill helpers.
// All logic lives in the CLI; no framework package dependency.
// ---------------------------------------------------------------------------

import type { PolyfillDefinition, PolyfillDomain, PolyfillContext, PolyfillNeed, RuntimePolyfillIR } from "../types";
import { getStdLibSupport } from "../types";
import { ProgramIR, StatementIR } from "../../ir/model";

// ---------------------------------------------------------------------------
// Polyfill definition
// ---------------------------------------------------------------------------

export const arrayMethodsPolyfill: PolyfillDefinition = {
  id: "array_methods",
  name: "Array Methods",
  description: "Maps array.push/pop/etc to C++ equivalents",
  domains: ["standard", "arduino", "embedded"] as PolyfillDomain[],

  detect(program: ProgramIR, context: PolyfillContext): PolyfillNeed[] {
    const needs: PolyfillNeed[] = [];
    const seen = new Set<string>();
    let needsStaticArray = false;

    const scanStatement = (stmt: StatementIR): void => {
      if (!needsStaticArray && isStaticArrayCandidate(stmt)) {
        needsStaticArray = true;
      }
      detectArrayMethodsInStatement(stmt, needs, seen);

      if (stmt.kind === "block" || stmt.kind === "labeled") {
        for (const nested of stmt.body) {
          scanStatement(nested);
        }
      }

      if (stmt.kind === "while" || stmt.kind === "do_while") {
        for (const nested of stmt.body) {
          scanStatement(nested);
        }
      }
      if (stmt.kind === "for" || stmt.kind === "for_of" || stmt.kind === "for_in") {
        for (const nested of stmt.body) {
          scanStatement(nested);
        }
      }
      if (stmt.kind === "if") {
        for (const nested of stmt.thenBranch) {
          scanStatement(nested);
        }
        if (stmt.elseBranch) {
          for (const nested of stmt.elseBranch) {
            scanStatement(nested);
          }
        }
      }
      if (stmt.kind === "switch") {
        for (const caseClause of stmt.cases) {
          for (const nested of caseClause.body) {
            scanStatement(nested);
          }
        }
      }
      if (stmt.kind === "try") {
        for (const nested of stmt.tryBlock) {
          scanStatement(nested);
        }
        if (stmt.catchBlock) {
          for (const nested of stmt.catchBlock) {
            scanStatement(nested);
          }
        }
      }
    };

    for (const fn of program.functions) {
      for (const stmt of fn.statements) {
        scanStatement(stmt);
      }
    }

    for (const stmt of program.topLevelStatements) {
      scanStatement(stmt);
    }

    for (const cls of program.classes) {
      for (const method of cls.methods) {
        for (const stmt of method.statements) {
          scanStatement(stmt);
        }
      }
      if (cls.constructor) {
        for (const stmt of cls.constructor.statements) {
          scanStatement(stmt);
        }
      }
    }

    // If we will use static arrays on this platform, emit the StaticArray helper
    // whenever a std::vector-backed array literal is used without std::vector support.
    const stdLib = getStdLibSupport(context.architecture);
    const impl = context.config?.arrays?.prefer === "std_vector"
      ? "std_vector"
      : context.config?.arrays?.prefer === "static_array"
        ? "static_array"
        : stdLib.recommendedArrayImpl;
    if (impl === "static_array" && needsStaticArray && !seen.has("array_static")) {
      seen.add("array_static");
      needs.push({
        id: "array_static",
        sourceSpan: program.topLevelStatements[0]?.sourceSpan ?? { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        details: { method: "static_array" },
      });
    }

    return needs;
  },

  generate(needs: PolyfillNeed[], context: PolyfillContext): RuntimePolyfillIR {
    const methods = new Set(needs.map(n => n.details.method));
    const stdLib = getStdLibSupport(context.architecture);

    let impl: "std_vector" | "static_array";
    if (context.config?.arrays?.prefer && context.config.arrays.prefer !== "auto") {
      impl = context.config.arrays.prefer === "std_vector" ? "std_vector" : "static_array";
    } else {
      impl = stdLib.recommendedArrayImpl;
    }

    if (impl === "std_vector") {
      return generateStdVectorArrayPolyfill(methods);
    } else {
      return generateStaticArrayPolyfill(methods, context.config?.arrays?.staticMaxSize ?? 32);
    }
  },
};

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function isStaticArrayCandidate(stmt: StatementIR): boolean {
  if (stmt.kind === "var_decl" && typeof stmt.cppType === "string") {
    const cppType = stmt.cppType;
    if (cppType.startsWith("std::vector<") && stmt.initializer?.kind === "array") {
      return true;
    }
    if (cppType === "auto" && stmt.initializer?.kind === "array") {
      return true;
    }
    if (cppType.startsWith("StaticArray<")) {
      return true;
    }
  }
  return false;
}

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

// ---------------------------------------------------------------------------
// std::vector-based array polyfill generator
// ---------------------------------------------------------------------------

/**
 * Generate a std::vector-based array polyfill.
 * Used on platforms with full C++ standard library (ESP32, RP2040, etc.).
 */
function generateStdVectorArrayPolyfill(methods: Set<string>): RuntimePolyfillIR {
  const shimMacros: string[] = [];

  // Map TypeScript array methods to std::vector methods
  if (methods.has("push")) {
    shimMacros.push(`// Array.push → vector.push_back`);
    shimMacros.push(`// Note: arr.push(x) should transpile to arr.push_back(x)`);
  }

  if (methods.has("pop")) {
    shimMacros.push(`// Array.pop → vector.pop_back`);
    shimMacros.push(`// Note: arr.pop() should transpile to arr.pop_back()`);
  }

  if (methods.has("length")) {
    shimMacros.push(`// Array.length → vector.size()`);
    shimMacros.push(`// Note: arr.length should transpile to arr.size()`);
  }

  return {
    kind: "polyfill",
    id: "array_methods",
    domain: "standard",
    requiredIncludes: ["<vector>"],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions: [],
    shimMacros,
    dependencies: [],
  };
}

// ---------------------------------------------------------------------------
// StaticArray template polyfill generator
// ---------------------------------------------------------------------------

/**
 * Generate a StaticArray template polyfill for constrained platforms.
 * Used on AVR and other microcontrollers without std::vector.
 */
function generateStaticArrayPolyfill(methods: Set<string>, maxSize: number): RuntimePolyfillIR {
  const helperStructs: string[] = [];

  // Generate StaticArray template for platforms without std::vector
  helperStructs.push(`
// Polyfill: StaticArray for platforms without std::vector
template<typename T, size_t MaxSize = ${maxSize}>
struct StaticArray {
    T data[MaxSize];
    size_t length = 0;
    
    void push_back(const T& value) {
        if (length < MaxSize) {
            data[length++] = value;
        }
    }
    
    T pop_back() {
        if (length > 0) {
            return data[--length];
        }
        return T();
    }
    
    T& operator[](size_t index) {
        return data[index];
    }
    
    const T& operator[](size_t index) const {
        return data[index];
    }
    
    size_t size() const { return length; }
    bool empty() const { return length == 0; }
    bool full() const { return length >= MaxSize; }
    
    T* begin() { return data; }
    T* end() { return data + length; }
    const T* begin() const { return data; }
    const T* end() const { return data + length; }
    
    void clear() { length = 0; }

    size_t indexOf(const T& value) const {
        for (size_t i = 0; i < length; i++) {
            if (data[i] == value) return i;
        }
        return (size_t)-1;
    }
};
`);

  const shimMacros: string[] = [
    `// Array methods using StaticArray`,
    `// Note: arr.push(x) → arr.push_back(x)`,
    `// Note: arr.pop() → arr.pop_back()`,
    `// Note: arr.length → arr.size()`,
  ];

  return {
    kind: "polyfill",
    id: "array_methods",
    domain: "embedded",
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs,
    helperFunctions: [],
    shimMacros,
    dependencies: [],
  };
}
