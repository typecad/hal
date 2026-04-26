// ---------------------------------------------------------------------------
// String methods polyfill — detection + generation
//
// Detection logic analyzes the IR for string method calls.
// C++ code generation produces std::string or StaticString polyfill helpers.
// All logic lives in the CLI; no framework package dependency.
// ---------------------------------------------------------------------------

import type { PolyfillDefinition, PolyfillDomain, PolyfillContext, PolyfillNeed, RuntimePolyfillIR } from "../types";
import { getStdLibSupport } from "../types";
import { ProgramIR, StatementIR } from "../../ir/model";

// ---------------------------------------------------------------------------
// Polyfill definition
// ---------------------------------------------------------------------------

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

    if (impl === "std_string") {
      return generateStdStringPolyfill(methods);
    } else {
      return generateStaticStringPolyfill(methods, context.config?.strings?.staticMaxLen ?? 64);
    }
  },
};

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// std::string-based string polyfill generator
// ---------------------------------------------------------------------------

/**
 * Generate a std::string-based string polyfill.
 * Used on platforms with full C++ standard library (ESP32, RP2040, etc.).
 */
function generateStdStringPolyfill(methods: Set<string>): RuntimePolyfillIR {
  const helperFunctions: string[] = [];
  const shimMacros: string[] = [];

  if (methods.has("toUpperCase")) {
    helperFunctions.push(`
// Polyfill: string.toUpperCase
inline std::string string_toUpperCase(const std::string& s) {
    std::string result = s;
    std::transform(result.begin(), result.end(), result.begin(), ::toupper);
    return result;
}
`);
    shimMacros.push(`#define toUpperCase() string_toUpperCase(*this)`);
  }

  if (methods.has("toLowerCase")) {
    helperFunctions.push(`
// Polyfill: string.toLowerCase
inline std::string string_toLowerCase(const std::string& s) {
    std::string result = s;
    std::transform(result.begin(), result.end(), result.begin(), ::tolower);
    return result;
}
`);
    shimMacros.push(`#define toLowerCase() string_toLowerCase(*this)`);
  }

  if (methods.has("includes")) {
    helperFunctions.push(`
// Polyfill: string.includes
inline bool string_includes(const std::string& s, const std::string& substr) {
    return s.find(substr) != std::string::npos;
}
`);
  }

  if (methods.has("startsWith")) {
    helperFunctions.push(`
// Polyfill: string.startsWith
inline bool string_startsWith(const std::string& s, const std::string& prefix) {
    return s.rfind(prefix, 0) == 0;
}
`);
  }

  if (methods.has("endsWith")) {
    helperFunctions.push(`
// Polyfill: string.endsWith
inline bool string_endsWith(const std::string& s, const std::string& suffix) {
    if (suffix.length() > s.length()) return false;
    return s.compare(s.length() - suffix.length(), suffix.length(), suffix) == 0;
}
`);
  }

  if (methods.has("trim")) {
    helperFunctions.push(`
// Polyfill: string.trim
inline std::string string_trim(const std::string& s) {
    size_t start = s.find_first_not_of(" \\t\\n\\r");
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(" \\t\\n\\r");
    return s.substr(start, end - start + 1);
}
`);
  }

  if (methods.has("indexOf")) {
    shimMacros.push(`// string.indexOf → string.find`);
  }

  if (methods.has("substring") || methods.has("slice")) {
    shimMacros.push(`// string.substring/slice → string.substr`);
  }

  return {
    kind: "polyfill",
    id: "string_methods",
    domain: "standard",
    requiredIncludes: ["<string>", "<algorithm>"],
    forwardDeclarations: [],
    helperStructs: [],
    helperFunctions,
    shimMacros,
    dependencies: [],
  };
}

// ---------------------------------------------------------------------------
// StaticString template polyfill generator
// ---------------------------------------------------------------------------

/**
 * Generate a StaticString template polyfill for constrained platforms.
 * Used on AVR and other microcontrollers without std::string.
 */
function generateStaticStringPolyfill(methods: Set<string>, maxLen: number): RuntimePolyfillIR {
  const helperStructs: string[] = [];

  helperStructs.push(`
// Polyfill: StaticString for platforms without std::string
template<size_t MaxLen = ${maxLen}>
struct StaticString {
    char data[MaxLen + 1];
    size_t length = 0;
    
    StaticString() { data[0] = '\\0'; }
    
    StaticString(const char* s) { set(s); }
    
    void set(const char* s) {
        size_t i = 0;
        while (s[i] && i < MaxLen) {
            data[i] = s[i];
            i++;
        }
        data[i] = '\\0';
        length = i;
    }
    
    StaticString& operator=(const char* s) {
        set(s);
        return *this;
    }
    
    bool operator==(const char* s) const {
        return strcmp(data, s) == 0;
    }
    
    bool includes(const char* substr) const {
        return strstr(data, substr) != nullptr;
    }
    
    bool startsWith(const char* prefix) const {
        size_t prefixLen = strlen(prefix);
        return length >= prefixLen && strncmp(data, prefix, prefixLen) == 0;
    }
    
    bool endsWith(const char* suffix) const {
        size_t suffixLen = strlen(suffix);
        return length >= suffixLen && strcmp(data + length - suffixLen, suffix) == 0;
    }
    
    const char* c_str() const { return data; }
    size_t size() const { return length; }
    
    void toUpperCase() {
        for (size_t i = 0; i < length; i++) {
            data[i] = toupper(data[i]);
        }
    }
    
    void toLowerCase() {
        for (size_t i = 0; i < length; i++) {
            data[i] = tolower(data[i]);
        }
    }
    
    void trim() {
        size_t start = 0;
        while (start < length && (data[start] == ' ' || data[start] == '\\t' || data[start] == '\\n')) {
            start++;
        }
        size_t end = length;
        while (end > start && (data[end - 1] == ' ' || data[end - 1] == '\\t' || data[end - 1] == '\\n')) {
            end--;
        }
        if (start > 0) {
            memmove(data, data + start, end - start);
        }
        length = end - start;
        data[length] = '\\0';
    }
};
`);

  return {
    kind: "polyfill",
    id: "string_methods",
    domain: "embedded",
    requiredIncludes: [],
    forwardDeclarations: [],
    helperStructs,
    helperFunctions: [],
    shimMacros: [],
    dependencies: [],
  };
}
