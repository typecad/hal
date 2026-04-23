// ---------------------------------------------------------------------------
// @typecode/framework-arduino — C++ Header Parser
//
// Parses C++ header files from Arduino libraries into an IR that can be
// used for TypeScript type declaration generation.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Arduino-to-TypeCode type mappings
// ---------------------------------------------------------------------------

/**
 * Maps Arduino peripheral C++ types to TypeCode equivalents.
 * Uses the instance names (I2C0, SPI0, UART0) as types for simplicity.
 */
const ARDUINO_TYPE_MAPPINGS: Record<string, string> = {
  // I2C - TypeCode uses I2C0 instance
  "TwoWire": "I2C0",
  "TwoWire*": "I2C0",
  "TwoWire&": "I2C0",
  // SPI - TypeCode uses SPI0 instance
  "SPIClass": "SPI0",
  "SPIClass*": "SPI0",
  "SPIClass&": "SPI0",
  // Serial - TypeCode uses UART0 instance
  "HardwareSerial": "UART0",
  "HardwareSerial*": "UART0",
  "HardwareSerial&": "UART0",
  "Stream": "UART0",
  "Stream*": "UART0",
  "Stream&": "UART0",
  // Common Arduino types
  "Print": "UART0",
  "Print*": "UART0",
  "Print&": "UART0",
};

// ---------------------------------------------------------------------------
// Parse result types
// ---------------------------------------------------------------------------

interface CppMethod {
  name: string;
  returnType: string;
  parameters: { type: string; name: string }[];
  isPublic: boolean;
}

interface CppClass {
  name: string;
  /** Fully qualified name including namespace (e.g., "Microfire::SHT3x") */
  fullName: string;
  /** Namespace prefix (e.g., "Microfire") */
  namespace?: string;
  methods: CppMethod[];
  constructors: { parameters: { type: string; name: string }[] }[];
}

export interface CppParseResult {
  classes: CppClass[];
  constants: { name: string; type: string; value: string }[];
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

/**
 * Maps C++ types to TypeScript types.
 */
export function mapCppTypeToTs(cppType: string): string {
  const trimmed = cppType.trim();
  
  // Remove const qualifier
  const withoutConst = trimmed.replace(/^const\s+/, "");
  
  // Check Arduino type mappings first
  if (ARDUINO_TYPE_MAPPINGS[withoutConst]) {
    return ARDUINO_TYPE_MAPPINGS[withoutConst];
  }
  
  // Basic type mappings
  const typeMap: Record<string, string> = {
    "int": "number",
    "unsigned int": "number",
    "uint8_t": "number",
    "uint16_t": "number",
    "uint32_t": "number",
    "int8_t": "number",
    "int16_t": "number",
    "int32_t": "number",
    "float": "number",
    "double": "number",
    "bool": "boolean",
    "void": "void",
    "char": "string",
    "char*": "string",
    "const char*": "string",
    "std::string": "string",
    "String": "string",
    "byte": "number",
    "word": "number",
    "size_t": "number",
  };
  
  // Check direct mapping
  if (typeMap[withoutConst]) {
    return typeMap[withoutConst];
  }
  
  // Handle pointers - check if base type is an Arduino type
  if (withoutConst.endsWith("*")) {
    const baseType = withoutConst.slice(0, -1).trim();
    if (ARDUINO_TYPE_MAPPINGS[baseType]) {
      return ARDUINO_TYPE_MAPPINGS[baseType];
    }
    return "number";
  }
  
  // Handle references - check if base type is an Arduino type
  if (withoutConst.endsWith("&")) {
    const baseType = withoutConst.slice(0, -1).trim();
    if (ARDUINO_TYPE_MAPPINGS[baseType]) {
      return ARDUINO_TYPE_MAPPINGS[baseType];
    }
    return mapCppTypeToTs(baseType);
  }
  
  // Default to any for unknown types
  return "any";
}

// ---------------------------------------------------------------------------
// Parameter parsing
// ---------------------------------------------------------------------------

/**
 * Extracts the parameter list from a function signature.
 */
export function parseParameters(paramString: string): { type: string; name: string }[] {
  if (!paramString.trim()) {
    return [];
  }
  
  const params: { type: string; name: string }[] = [];
  const parts = paramString.split(",");
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    // Handle default values (remove them for the declaration)
    const withoutDefault = trimmed.split("=")[0].trim();
    
    // Split into tokens to find type and name
    const tokens = withoutDefault.split(/\s+/);
    if (tokens.length >= 2) {
      // Last token is the name, rest is the type
      let name = tokens[tokens.length - 1];
      let type = tokens.slice(0, -1).join(" ");
      
      // Strip & and * prefixes from parameter names (C++ reference/pointer syntax)
      // These can appear as &name or *name when the type doesn't include them
      if (name.startsWith("&") || name.startsWith("*")) {
        // Move the & or * to the type
        type = type + name[0];
        name = name.slice(1);
      }
      
      params.push({ type: mapCppTypeToTs(type), name });
    } else if (tokens.length === 1) {
      // Just a type (unnamed parameter)
      params.push({ type: mapCppTypeToTs(tokens[0]), name: "" });
    }
  }
  
  return params;
}

// ---------------------------------------------------------------------------
// Class parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract content inside a namespace block.
 */
function extractNamespaceContent(content: string, namespaceName: string): string {
  // Find namespace block: namespace Name { ... }
  const namespaceRegex = new RegExp(`namespace\\s+${namespaceName}\\s*\\{`, 'g');
  const match = namespaceRegex.exec(content);
  if (!match) return "";
  
  const startIndex = match.index + match[0].length;
  let braceCount = 1;
  let endIndex = startIndex;
  
  while (endIndex < content.length && braceCount > 0) {
    if (content[endIndex] === '{') braceCount++;
    else if (content[endIndex] === '}') braceCount--;
    endIndex++;
  }
  
  return content.slice(startIndex, endIndex - 1);
}

/**
 * Parse classes from content, optionally within a namespace.
 */
function parseClassesFromContent(content: string, namespace?: string): CppClass[] {
  const classes: CppClass[] = [];
  
  // Parse class definitions - handle nested braces properly
  const classStartRegex = /\bclass\s+(\w+)\s*\{?/g;
  let classStartMatch;
  
  while ((classStartMatch = classStartRegex.exec(content)) !== null) {
    const className = classStartMatch[1];
    const fullName = namespace ? `${namespace}::${className}` : className;
    
    const cppClass: CppClass = {
      name: className,
      fullName,
      namespace,
      methods: [],
      constructors: [],
    };
    
    // For header files, try to find method declarations
    // Match: type name(params);
    const methodRegex = /(\w+(?:\s*[*&])?)\s+(\w+)\s*\(([^)]*)\)\s*(?:const\s*)?;/g;
    let methodMatch;
    
    while ((methodMatch = methodRegex.exec(content)) !== null) {
      const returnType = methodMatch[1].trim();
      const name = methodMatch[2].trim();
      const params = methodMatch[3];
      
      // Skip keywords
      if (["public", "private", "protected", "virtual", "static", "class", "struct"].includes(returnType)) {
        continue;
      }
      
      // Check if this is a constructor (name matches class name)
      if (name === className) {
        cppClass.constructors.push({
          parameters: parseParameters(params),
        });
      } else {
        cppClass.methods.push({
          returnType: mapCppTypeToTs(returnType),
          name,
          parameters: parseParameters(params),
          isPublic: true,
        });
      }
    }
    
    classes.push(cppClass);
  }
  
  return classes;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parses a C++ class definition from header content.
 */
export function parseCppClass(content: string): CppParseResult {
  const result: CppParseResult = {
    classes: [],
    constants: [],
  };
  
  // Parse top-level constants: const int NAME = value;
  const constRegex = /const\s+(\w+)\s+(\w+)\s*=\s*([^;]+);/g;
  let constMatch;
  while ((constMatch = constRegex.exec(content)) !== null) {
    result.constants.push({
      type: mapCppTypeToTs(constMatch[1]),
      name: constMatch[2],
      value: constMatch[3].trim(),
    });
  }
  
  // Parse methods with scope resolution (ClassName::methodName) - for .cpp implementation files
  const scopeResolutionRegex = /(?:^|\n)\s*(?:(\w+(?:\s*[*&])?)\s+)?(\w+)::(\w+)\s*\(([^)]*)\)\s*(?:const\s*)?(?:\{|;)/g;
  let scopeMatch;
  const classesFromImpl = new Map<string, CppClass>();
  
  while ((scopeMatch = scopeResolutionRegex.exec(content)) !== null) {
    const returnType = scopeMatch[1]?.trim();
    const className = scopeMatch[2];
    const methodName = scopeMatch[3];
    const params = scopeMatch[4];
    
    // Skip if this looks like a namespace (e.g., std::something)
    if (!returnType && className.toLowerCase() === className) {
      continue;
    }
    
    if (!classesFromImpl.has(className)) {
      classesFromImpl.set(className, {
        name: className,
        fullName: className,
        methods: [],
        constructors: [],
      });
    }
    
    const cppClass = classesFromImpl.get(className)!;
    
    // Check if this is a constructor (method name matches class name)
    if (methodName === className) {
      cppClass.constructors.push({
        parameters: parseParameters(params),
      });
    } else if (returnType) {
      cppClass.methods.push({
        returnType: mapCppTypeToTs(returnType),
        name: methodName,
        parameters: parseParameters(params),
        isPublic: true,
      });
    }
  }
  
  // Add inferred classes to result
  for (const cppClass of classesFromImpl.values()) {
    result.classes.push(cppClass);
  }
  
  // Parse namespaces first
  const namespaceRegex = /namespace\s+(\w+)\s*\{/g;
  let nsMatch;
  const namespaces: string[] = [];
  
  while ((nsMatch = namespaceRegex.exec(content)) !== null) {
    namespaces.push(nsMatch[1]);
  }
  
  // Parse classes within each namespace
  for (const ns of namespaces) {
    const nsContent = extractNamespaceContent(content, ns);
    const nsClasses = parseClassesFromContent(nsContent, ns);
    result.classes.push(...nsClasses);
  }
  
  // Parse classes outside of namespaces (skip if already found in a namespace)
  const namespaceClassNames = new Set(result.classes.map(c => c.name));
  const topLevelClasses = parseClassesFromContent(content);
  for (const cls of topLevelClasses) {
    if (!namespaceClassNames.has(cls.name)) {
      result.classes.push(cls);
    }
  }
  
  return result;
}
