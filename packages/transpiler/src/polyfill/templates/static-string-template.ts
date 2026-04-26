/**
 * StaticString polyfill template.
 * Automatically generates platform-appropriate string implementations.
 */

import { registerPolyfillTemplate, type ArchitectureCapabilities, type PolyfillTemplate } from "../template-types";

export const STATIC_STRING_TEMPLATE: PolyfillTemplate = {
  id: "static_string",
  name: "Static String",
  description: "Fixed-size string implementation for platforms without std::string",

  commonIncludes: [],

  placeholders: [
    {
      name: "MAX_LEN",
      description: "Maximum string length",
      resolve: (caps, config) => String(config?.maxLen ?? caps.recommendedStaticStringLength),
    },
    {
      name: "SIZE_TYPE",
      description: "Type for size/length values",
      resolve: (caps) => caps.wordSize <= 8 ? "uint8_t" : "size_t",
    },
  ],

  variants: [
    {
      name: "std_string",
      condition: (caps) => caps.hasString && caps.hasDynamicMemory,
      requiredCapabilities: ["hasString", "hasDynamicMemory"],
      includes: ["<string>"],
      forwardDeclarations: [],
      code: `// Using std::string - no additional code needed
// String operations map directly to std::string methods:
//   str.length -> str.size()
//   str.charAt(i) -> str[i]
//   str.substring(s,e) -> str.substr(s, e-s)
//   str.indexOf(s) -> str.find(s)
`,
    },
    {
      name: "static_string",
      condition: (caps) => !caps.hasString || !caps.hasDynamicMemory,
      requiredCapabilities: ["hasTemplates"],
      includes: [],
      forwardDeclarations: [],
      code: `// Polyfill: StaticString for platforms without std::string
template<{{SIZE_TYPE}} MaxLen = {{MAX_LEN}}>
struct StaticString {
    char data[MaxLen + 1];  // +1 for null terminator
    {{SIZE_TYPE}} len = 0;

    StaticString() {
        data[0] = '\\0';
    }

    StaticString(const char* str) {
        copyFrom(str);
    }

    void copyFrom(const char* str) {
        len = 0;
        while (str[len] && len < MaxLen) {
            data[len] = str[len];
            len++;
        }
        data[len] = '\\0';
    }

    // Assignment
    StaticString& operator=(const char* str) {
        copyFrom(str);
        return *this;
    }

    // Access
    char operator[]({{SIZE_TYPE}} index) const { return data[index]; }
    char& operator[]({{SIZE_TYPE}} index) { return data[index]; }
    char charAt({{SIZE_TYPE}} index) const { return data[index]; }

    // Properties
    {{SIZE_TYPE}} size() const { return len; }
    {{SIZE_TYPE}} length() const { return len; }
    bool empty() const { return len == 0; }
    const char* c_str() const { return data; }

    // Modification
    void clear() {
        len = 0;
        data[0] = '\\0';
    }

    StaticString& append(const char* str) {
        while (*str && len < MaxLen) {
            data[len++] = *str++;
        }
        data[len] = '\\0';
        return *this;
    }

    StaticString& append(char c) {
        if (len < MaxLen) {
            data[len++] = c;
            data[len] = '\\0';
        }
        return *this;
    }

    // Search
    {{SIZE_TYPE}} indexOf(char c) const {
        for ({{SIZE_TYPE}} i = 0; i < len; i++) {
            if (data[i] == c) return i;
        }
        return ({{SIZE_TYPE}})-1;
    }

    {{SIZE_TYPE}} indexOf(const char* substr) const {
        // Simple substring search
        {{SIZE_TYPE}} subLen = 0;
        while (substr[subLen]) subLen++;

        for ({{SIZE_TYPE}} i = 0; i <= len - subLen; i++) {
            bool match = true;
            for ({{SIZE_TYPE}} j = 0; j < subLen; j++) {
                if (data[i + j] != substr[j]) {
                    match = false;
                    break;
                }
            }
            if (match) return i;
        }
        return ({{SIZE_TYPE}})-1;
    }

    // Substring
    StaticString substring({{SIZE_TYPE}} start, {{SIZE_TYPE}} end = ({{SIZE_TYPE}})-1) const {
        if (end == ({{SIZE_TYPE}})-1 || end > len) end = len;
        StaticString result;
        for ({{SIZE_TYPE}} i = start; i < end && result.len < MaxLen; i++) {
            result.data[result.len++] = data[i];
        }
        result.data[result.len] = '\\0';
        return result;
    }

    // Comparison
    bool equals(const char* str) const {
        {{SIZE_TYPE}} i = 0;
        while (str[i] && i < len) {
            if (data[i] != str[i]) return false;
            i++;
        }
        return str[i] == '\\0' && i == len;
    }

    bool operator==(const char* str) const { return equals(str); }
    bool operator==(const StaticString& other) const { return equals(other.data); }
};

// Default string type
using String = StaticString<{{MAX_LEN}}>;
`,
    },
  ],
};

// Auto-register
registerPolyfillTemplate(STATIC_STRING_TEMPLATE);