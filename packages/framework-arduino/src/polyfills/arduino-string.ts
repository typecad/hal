// ---------------------------------------------------------------------------
// Arduino string method polyfill generators
//
// Platform-specific C++ generation for string polyfills (StaticString template,
// std::string mapping). The CLI polyfill detection logic delegates to these
// generators for the actual C++ code output.
// ---------------------------------------------------------------------------

import type { RuntimePolyfillIR } from "@typecode/core/shared";

/**
 * Generate a std::string-based string polyfill.
 * Used on platforms with full C++ standard library (ESP32, RP2040, etc.).
 */
export function generateStdStringPolyfill(methods: Set<string>): RuntimePolyfillIR {
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

/**
 * Generate a StaticString template polyfill for constrained platforms.
 * Used on AVR and other microcontrollers without std::string.
 */
export function generateStaticStringPolyfill(methods: Set<string>, maxLen: number): RuntimePolyfillIR {
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