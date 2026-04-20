// ---------------------------------------------------------------------------
// Arduino array method polyfill generators
//
// Platform-specific C++ generation for array polyfills (StaticArray template,
// std::vector mapping). The CLI polyfill detection logic delegates to these
// generators for the actual C++ code output.
// ---------------------------------------------------------------------------

import type { RuntimePolyfillIR } from "@typecode/core/shared";

/**
 * Generate a std::vector-based array polyfill.
 * Used on platforms with full C++ standard library (ESP32, RP2040, etc.).
 */
export function generateStdVectorArrayPolyfill(methods: Set<string>): RuntimePolyfillIR {
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

/**
 * Generate a StaticArray template polyfill for constrained platforms.
 * Used on AVR and other microcontrollers without std::vector.
 */
export function generateStaticArrayPolyfill(methods: Set<string>, maxSize: number): RuntimePolyfillIR {
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