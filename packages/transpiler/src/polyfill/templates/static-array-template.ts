/**
 * StaticArray polyfill template.
 * Automatically generates platform-appropriate array implementations.
 */

import { registerPolyfillTemplate, type ArchitectureCapabilities, type PolyfillTemplate } from "../template-types";

export const STATIC_ARRAY_TEMPLATE: PolyfillTemplate = {
  id: "static_array",
  name: "Static Array",
  description: "Fixed-size array implementation for platforms without std::vector",

  commonIncludes: [],

  placeholders: [
    {
      name: "MAX_SIZE",
      description: "Maximum array capacity",
      resolve: (caps, config) => String(config?.maxSize ?? caps.recommendedStaticArraySize),
    },
    {
      name: "SIZE_TYPE",
      description: "Type for size/capacity values",
      resolve: (caps) => caps.wordSize <= 8 ? "uint8_t" : "size_t",
    },
  ],

  variants: [
    {
      name: "std_vector",
      condition: (caps) => caps.hasVector && caps.hasDynamicMemory,
      requiredCapabilities: ["hasVector", "hasDynamicMemory"],
      includes: ["<vector>"],
      forwardDeclarations: [],
      code: `// Using std::vector - no additional code needed
// Array operations map directly to vector methods:
//   arr.push(x) -> arr.push_back(x)
//   arr.pop() -> arr.pop_back()
//   arr.length -> arr.size()
`,
    },
    {
      name: "static_array",
      condition: (caps) => !caps.hasVector || !caps.hasDynamicMemory,
      requiredCapabilities: ["hasTemplates"],
      includes: [],
      forwardDeclarations: [],
      code: `// Polyfill: StaticArray for platforms without std::vector
template<typename T, {{SIZE_TYPE}} MaxSize = {{MAX_SIZE}}>
struct StaticArray {
    T data[MaxSize];
    {{SIZE_TYPE}} length = 0;

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

    T& operator[]({{SIZE_TYPE}} index) { return data[index]; }
    const T& operator[]({{SIZE_TYPE}} index) const { return data[index]; }

    {{SIZE_TYPE}} size() const { return length; }
    bool empty() const { return length == 0; }
    bool full() const { return length >= MaxSize; }

    T* begin() { return data; }
    T* end() { return data + length; }
    const T* begin() const { return data; }
    const T* end() const { return data + length; }

    void clear() { length = 0; }

    // Additional array-like methods
    {{SIZE_TYPE}} indexOf(const T& value) const {
        for ({{SIZE_TYPE}} i = 0; i < length; i++) {
            if (data[i] == value) return i;
        }
        return ({{SIZE_TYPE}})-1;
    }

    bool contains(const T& value) const {
        return indexOf(value) != ({{SIZE_TYPE}})-1;
    }

    bool remove(const T& value) {
        {{SIZE_TYPE}} idx = indexOf(value);
        if (idx == ({{SIZE_TYPE}})-1) return false;
        for ({{SIZE_TYPE}} i = idx; i < length - 1; i++) {
            data[i] = data[i + 1];
        }
        length--;
        return true;
    }
};

// Type alias for convenience
template<typename T>
using Array = StaticArray<T, {{MAX_SIZE}}>;
`,
    },
  ],
};

// Auto-register
registerPolyfillTemplate(STATIC_ARRAY_TEMPLATE);