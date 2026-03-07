/**
 * Arduino Library Utilities
 * 
 * Handles discovery and .d.ts generation for Arduino libraries installed via arduino-cli.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * Information about an installed Arduino library
 */
export interface ArduinoLibrary {
  /** Library name (e.g., "BH1750") */
  name: string;
  /** Version string */
  version?: string;
  /** Path to the library directory */
  path: string;
  /** Author information */
  author?: string;
  /** Brief description */
  sentence?: string;
}

/**
 * Result from arduino-cli lib list --format json
 */
interface ArduinoCliLibrary {
  name: string;
  version?: string;
  install_dir?: string;
  author?: string;
  sentence?: string;
}

/**
 * Result from arduino-cli lib list --format json (wrapped format)
 */
interface ArduinoCliLibListResult {
  installed_libraries?: {
    library: ArduinoCliLibrary;
  }[];
}

/**
 * Cache for installed Arduino libraries
 */
let libraryCache: Map<string, ArduinoLibrary> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Execute arduino-cli and return parsed JSON output
 */
function runArduinoCli(args: string[]): unknown | null {
  try {
    const result = spawnSync("arduino-cli", args, {
      encoding: "utf8",
      timeout: 30000,
    });

    if (result.status !== 0) {
      return null;
    }

    const output = result.stdout?.trim();
    if (!output) {
      return null;
    }

    return JSON.parse(output);
  } catch {
    return null;
  }
}

/**
 * Get all installed Arduino libraries using arduino-cli
 */
export function getInstalledLibraries(): Map<string, ArduinoLibrary> {
  // Check cache
  const now = Date.now();
  if (libraryCache && (now - cacheTimestamp) < CACHE_TTL) {
    return libraryCache;
  }

  const libraries = new Map<string, ArduinoLibrary>();

  // Run arduino-cli lib list --format json
  const result = runArduinoCli(["lib", "list", "--format", "json"]);
  
  if (!result) {
    libraryCache = libraries;
    cacheTimestamp = now;
    return libraries;
  }

  // Handle both formats:
  // 1. { installed_libraries: [{ library: {...} }] } (newer arduino-cli)
  // 2. [{ ... }] (older format or different command)
  let libList: ArduinoCliLibrary[] = [];
  
  if (Array.isArray(result)) {
    libList = result as ArduinoCliLibrary[];
  } else if (typeof result === "object" && result !== null) {
    const wrapped = result as ArduinoCliLibListResult;
    if (wrapped.installed_libraries && Array.isArray(wrapped.installed_libraries)) {
      libList = wrapped.installed_libraries.map(item => item.library);
    }
  }

  for (const lib of libList) {
    if (!lib.name || !lib.install_dir) {
      continue;
    }

    const library: ArduinoLibrary = {
      name: lib.name,
      version: lib.version,
      path: lib.install_dir,
      author: lib.author,
      sentence: lib.sentence,
    };

    // Store by name (case-insensitive key)
    libraries.set(lib.name.toLowerCase(), library);
    // Also store with original casing
    if (lib.name !== lib.name.toLowerCase()) {
      libraries.set(lib.name, library);
    }
  }

  libraryCache = libraries;
  cacheTimestamp = now;
  return libraries;
}

/**
 * Find an Arduino library by name
 */
export function findArduinoLibrary(name: string): ArduinoLibrary | undefined {
  const libraries = getInstalledLibraries();
  
  // Try exact match first, then case-insensitive
  return libraries.get(name) || libraries.get(name.toLowerCase());
}

/**
 * Find the main header file for an Arduino library
 * Arduino libraries typically have a .h file matching the library name
 */
export function findLibraryHeader(library: ArduinoLibrary): string | undefined {
  const libName = library.name;
  const libDir = library.path;

  if (!fs.existsSync(libDir)) {
    return undefined;
  }

  // Common header locations:
  // 1. LibraryName.h in root
  // 2. src/LibraryName.h
  // 3. Any .h file in root if only one exists
  
  const candidates = [
    path.join(libDir, `${libName}.h`),
    path.join(libDir, "src", `${libName}.h`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  // Fallback: look for any .h file in the root or src directory
  const dirs = [libDir, path.join(libDir, "src")];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    
    const headers: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".h")) {
        headers.push(path.join(dir, entry.name));
      }
    }
    
    // If there's only one header, use it
    if (headers.length === 1) {
      return headers[0];
    }
    
    // If there are multiple, prefer one matching the library name
    for (const h of headers) {
      if (path.basename(h, ".h").toLowerCase() === libName.toLowerCase()) {
        return h;
      }
    }
  }

  return undefined;
}

/**
 * Find all source files (.h, .cpp) for an Arduino library
 */
export function findLibrarySources(library: ArduinoLibrary): { headers: string[]; cpps: string[] } {
  const libDir = library.path;
  const headers: string[] = [];
  const cpps: string[] = [];

  if (!fs.existsSync(libDir)) {
    return { headers, cpps };
  }

  // Search directories: root, src
  const searchDirs = [libDir, path.join(libDir, "src")];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;

      const fullPath = path.join(dir, entry.name);
      const lower = entry.name.toLowerCase();

      if (lower.endsWith(".h")) {
        headers.push(fullPath);
      } else if (lower.endsWith(".cpp")) {
        cpps.push(fullPath);
      }
    }
  }

  return { headers, cpps };
}

/**
 * Check if a module specifier looks like an Arduino library import
 * Arduino library imports are bare names like "BH1750", "Servo", "Wire"
 * (not relative paths, not npm packages)
 */
export function isArduinoLibraryImport(moduleSpecifier: string): boolean {
  // Skip relative imports
  if (moduleSpecifier.startsWith(".")) {
    return false;
  }

  // Skip npm-style imports (scoped or with path separators)
  if (moduleSpecifier.startsWith("@") || moduleSpecifier.includes("/")) {
    return false;
  }

  // Skip known non-Arduino imports
  const skipList = new Set([
    "typecode",
    "typescript",
    "node",
    "fs",
    "path",
    "http",
    "https",
    "crypto",
    "os",
    "util",
  ]);
  
  if (skipList.has(moduleSpecifier.toLowerCase())) {
    return false;
  }

  return true;
}

/**
 * Arduino-to-TypeCode type mappings
 * Maps common Arduino peripheral types to TypeCode equivalents
 * Note: Uses the instance names (I2C0, SPI0, UART0) as types for simplicity
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

/**
 * Maps C++ types to TypeScript types (exported for testing)
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

/**
 * Extracts the parameter list from a function signature (exported for testing)
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

interface CppParseResult {
  classes: CppClass[];
  constants: { name: string; type: string; value: string }[];
}

/**
 * Extract content inside a namespace block
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
 * Parse classes from content, optionally within a namespace
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

/**
 * Parses a C++ class definition (exported for testing)
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

/**
 * Find the project root by looking for package.json or tsconfig.json
 */
function findProjectRoot(fromFile: string): string | undefined {
  let currentDir = path.dirname(path.resolve(fromFile));
  
  while (currentDir !== path.dirname(currentDir)) {
    if (fs.existsSync(path.join(currentDir, "package.json")) ||
        fs.existsSync(path.join(currentDir, "tsconfig.json"))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  
  return undefined;
}

/**
 * Generate export-based declaration content for @types packages
 */
function generateExportDeclaration(
  parsed: CppParseResult,
  moduleDocstring?: string,
  libraryName?: string
): string {
  const lines: string[] = [];
  
  // Add header comment explaining auto-generation and manual editing
  lines.push("/**");
  if (moduleDocstring) {
    lines.push(` * ${moduleDocstring}`);
  }
  lines.push(" *");
  lines.push(" * Auto-generated by TypeCode from Arduino library C++ headers.");
  lines.push(" * Arduino peripheral types (TwoWire, HardwareSerial, etc.) are mapped to TypeCode equivalents.");
  lines.push(" *");
  lines.push(" * You can manually edit this file to:");
  lines.push(" *   - Add missing methods or properties");
  lines.push(" *   - Fix incorrect type mappings");
  lines.push(" *   - Add JSDoc documentation");
  lines.push(" *");
  lines.push(" * To regenerate: delete this file and re-run typecode transpile.");
  lines.push(" */");
  lines.push("");
  
  // Export constants
  for (const constant of parsed.constants) {
    lines.push(`export declare const ${constant.name}: ${constant.type};`);
  }
  
  if (parsed.constants.length > 0 && parsed.classes.length > 0) {
    lines.push("");
  }
  
  // Export classes
  for (const cppClass of parsed.classes) {
    lines.push(`export declare class ${cppClass.name} {`);
    
    // Add constructors
    for (const ctor of cppClass.constructors) {
      const params = ctor.parameters
        .filter(p => p.name)
        .map(p => `${p.name}: ${p.type}`)
        .join(", ");
      lines.push(`  constructor(${params});`);
    }
    
    // Add public methods
    const publicMethods = cppClass.methods.filter(m => m.isPublic);
    for (const method of publicMethods) {
      const params = method.parameters
        .filter(p => p.name)
        .map(p => `${p.name}: ${p.type}`)
        .join(", ");
      lines.push(`  ${method.name}(${params}): ${method.returnType};`);
    }
    
    lines.push("}");
  }
  
  lines.push("");
  
  return lines.join("\n");
}

/**
 * Result of generating a .d.ts file for an Arduino library
 */
export interface GeneratedArduinoLib {
  /** Path to the generated .d.ts file */
  declPath: string;
  /** The actual header file name (e.g., "Microfire_SHT3x.h") */
  headerName: string;
}

/**
 * Generate a .d.ts file for an Arduino library
 * Returns the path to the generated file and header info, or undefined if generation failed
 */
export function generateArduinoLibDecl(
  library: ArduinoLibrary,
  fromFile: string
): GeneratedArduinoLib | undefined {
  // Find the main header file
  const headerPath = findLibraryHeader(library);
  if (!headerPath) {
    console.log(`  No header file found for Arduino library '${library.name}'`);
    return undefined;
  }

  if (!fs.existsSync(headerPath)) {
    console.log(`  Header file does not exist: ${headerPath}`);
    return undefined;
  }

  const content = fs.readFileSync(headerPath, "utf8");
  const parsed = parseCppClass(content);
  
  if (parsed.classes.length === 0 && parsed.constants.length === 0) {
    console.log(`  No class definitions found in '${library.name}' header`);
    return undefined;
  }

  // Generate export-based declaration for @types
  const declaration = generateExportDeclaration(
    parsed,
    `Arduino library: ${library.name}`
  );
  
  // Find project root
  const projectRoot = findProjectRoot(fromFile);
  if (!projectRoot) {
    console.log(`  Could not find project root for '${fromFile}'`);
    return undefined;
  }
  
  // Place declarations in node_modules/@types/LibraryName/
  // TypeScript automatically looks here for type declarations
  const typeDir = path.join(projectRoot, "node_modules", "@types", library.name);
  
  // Ensure output directory exists
  if (!fs.existsSync(typeDir)) {
    fs.mkdirSync(typeDir, { recursive: true });
  }
  
  const declPath = path.join(typeDir, "index.d.ts");
  
  // Write the declaration file
  fs.writeFileSync(declPath, declaration, "utf8");
  
  // Also write a minimal package.json for module resolution
  const packageJson = {
    name: `@types/${library.name}`,
    version: "0.0.0",
    main: "index.d.ts",
    types: "index.d.ts"
  };
  fs.writeFileSync(
    path.join(typeDir, "package.json"),
    JSON.stringify(packageJson, null, 2),
    "utf8"
  );
  
  // Extract the actual header file name from the path
  const headerName = path.basename(headerPath);
  
  // Generate usage documentation
  const usageDoc = generateUsageDocumentation(parsed, library.name, library);
  fs.writeFileSync(
    path.join(typeDir, "USAGE.md"),
    usageDoc,
    "utf8"
  );
  
  return { declPath, headerName };
}

/**
 * Try to generate .d.ts for a missing Arduino library import
 * Returns the path to the generated declaration file, or undefined if not found
 */
export function tryGenerateArduinoLibDecl(
  moduleSpecifier: string,
  fromFile: string
): string | undefined {
  // Check if this looks like an Arduino library import
  if (!isArduinoLibraryImport(moduleSpecifier)) {
    return undefined;
  }

  // Find the library
  const library = findArduinoLibrary(moduleSpecifier);
  if (!library) {
    return undefined;
  }

  console.log(`\n  Found Arduino library '${library.name}' at: ${library.path}`);
  
  // Generate the declaration (pass the full fromFile path for project root detection)
  const result = generateArduinoLibDecl(library, fromFile);
  
  if (result) {
    console.log(`  Generated declaration: ${result.declPath}`);
    console.log(`  Review the generated types and adjust if needed.\n`);
    return result.declPath;
  }

  return undefined;
}

/**
 * Try to get the actual header file name for an Arduino library import
 * Returns the header file name (e.g., "Microfire_SHT3x.h") or undefined if not found
 */
export function getArduinoLibraryHeaderName(moduleSpecifier: string): string | undefined {
  // Check if this looks like an Arduino library import
  if (!isArduinoLibraryImport(moduleSpecifier)) {
    return undefined;
  }

  // Find the library
  const library = findArduinoLibrary(moduleSpecifier);
  if (!library) {
    return undefined;
  }

  // Find the main header file
  const headerPath = findLibraryHeader(library);
  if (!headerPath) {
    return undefined;
  }

  return path.basename(headerPath);
}

/**
 * Get fully qualified class names for an Arduino library
 * Returns a map of simple class name to fully qualified name (e.g., "SHT3x" -> "Microfire::SHT3x")
 */
export function getArduinoLibraryClassNames(moduleSpecifier: string): Map<string, string> {
  const result = new Map<string, string>();
  
  // Check if this looks like an Arduino library import
  if (!isArduinoLibraryImport(moduleSpecifier)) {
    return result;
  }

  // Find the library
  const library = findArduinoLibrary(moduleSpecifier);
  if (!library) {
    return result;
  }

  // Find the main header file
  const headerPath = findLibraryHeader(library);
  if (!headerPath || !fs.existsSync(headerPath)) {
    return result;
  }

  const content = fs.readFileSync(headerPath, "utf8");
  const parsed = parseCppClass(content);
  
  for (const cppClass of parsed.classes) {
    // Map simple name to full name
    result.set(cppClass.name, cppClass.fullName);
  }
  
  return result;
}

/**
 * Generate usage documentation for an Arduino library (exported for testing)
 */
export function generateUsageDocumentation(
  parsed: CppParseResult,
  libraryName: string,
  library?: ArduinoLibrary
): string {
  const lines: string[] = [];
  
  lines.push(`# ${libraryName} - TypeCode Usage Guide`);
  lines.push("");
  
  if (library?.sentence) {
    lines.push(`> ${library.sentence}`);
    lines.push("");
  }
  
  if (library?.author) {
    lines.push(`**Author:** ${library.author}`);
    lines.push("");
  }
  
  lines.push("## Overview");
  lines.push("");
  lines.push(`This library was auto-discovered from your Arduino installation and TypeCode`);
  lines.push(`has generated TypeScript type definitions for it.`);
  lines.push("");
  
  if (parsed.classes.length > 0) {
    lines.push("## Classes");
    lines.push("");
    
    for (const cppClass of parsed.classes) {
      lines.push(`### ${cppClass.name}`);
      lines.push("");
      
      // Show C++ fully qualified name if different
      if (cppClass.fullName !== cppClass.name) {
        lines.push(`**C++:** \`${cppClass.fullName}\``);
        lines.push("");
      }
      
      // Constructor
      if (cppClass.constructors.length > 0) {
        lines.push("#### Constructor");
        lines.push("");
        lines.push("```typescript");
        lines.push(`import { ${cppClass.name} } from '${libraryName}';`);
        lines.push("");
        
        for (const ctor of cppClass.constructors) {
          const params = ctor.parameters
            .filter(p => p.name)
            .map(p => `${p.name}: ${p.type}`)
            .join(", ");
          lines.push(`const sensor = new ${cppClass.name}(${params});`);
        }
        lines.push("```");
        lines.push("");
      }
      
      // Methods
      if (cppClass.methods.length > 0) {
        lines.push("#### Methods");
        lines.push("");
        lines.push("| Method | Parameters | Returns |");
        lines.push("|--------|------------|---------|");
        
        for (const method of cppClass.methods) {
          const params = method.parameters
            .filter(p => p.name)
            .map(p => `${p.name}: ${p.type}`)
            .join(", ");
          lines.push(`| \`${method.name}()\` | ${params || "none"} | ${method.returnType} |`);
        }
        lines.push("");
        
        // Usage examples
        lines.push("#### Example Usage");
        lines.push("");
        lines.push("```typescript");
        lines.push(`import { ${cppClass.name} } from '${libraryName}';`);
        
        // Add peripheral imports if needed
        const peripheralTypes = new Set<string>();
        for (const method of cppClass.methods) {
          for (const param of method.parameters) {
            if (param.type === "I2C0" || param.type === "I2C1") {
              peripheralTypes.add("I2C0");
            } else if (param.type === "SPI0" || param.type === "SPI1") {
              peripheralTypes.add("SPI0");
            } else if (param.type === "UART0" || param.type === "UART1") {
              peripheralTypes.add("UART0");
            }
          }
          for (const ctor of cppClass.constructors) {
            for (const param of ctor.parameters) {
              if (param.type === "I2C0" || param.type === "I2C1") {
                peripheralTypes.add("I2C0");
              } else if (param.type === "SPI0" || param.type === "SPI1") {
                peripheralTypes.add("SPI0");
              } else if (param.type === "UART0" || param.type === "UART1") {
                peripheralTypes.add("UART0");
              }
            }
          }
        }
        
        if (peripheralTypes.size > 0) {
          lines.push(`import { ${[...peripheralTypes].join(", ")} } from '@typecode';`);
        }
        lines.push("");
        
        // Constructor example
        if (cppClass.constructors.length > 0) {
          const ctor = cppClass.constructors[0];
          const args = ctor.parameters
            .filter(p => p.name)
            .map(p => {
              // Provide example values for common types
              if (p.type === "I2C0") return "I2C0";
              if (p.type === "SPI0") return "SPI0";
              if (p.type === "UART0") return "UART0";
              if (p.type === "number") return "0x44";
              if (p.type === "boolean") return "true";
              if (p.type === "string") return '"example"';
              return p.name;
            })
            .join(", ");
          lines.push(`const device = new ${cppClass.name}(${args});`);
        } else {
          lines.push(`const device = new ${cppClass.name}();`);
        }
        lines.push("");
        
        // Show common method calls
        const beginMethod = cppClass.methods.find(m => m.name === "begin");
        if (beginMethod) {
          const args = beginMethod.parameters
            .filter(p => p.name)
            .map(p => {
              if (p.type === "I2C0") return "I2C0";
              if (p.type === "SPI0") return "SPI0";
              if (p.type === "UART0") return "UART0";
              if (p.type === "number") return "0x44";
              if (p.type === "boolean") return "true";
              return p.name;
            })
            .join(", ");
          lines.push(`device.begin(${args});`);
        }
        
        const measureMethod = cppClass.methods.find(m => m.name === "measure" || m.name === "read");
        if (measureMethod) {
          lines.push(`device.${measureMethod.name}();`);
        }
        
        const connectedMethod = cppClass.methods.find(m => m.name === "connected" || m.name === "begin");
        if (connectedMethod && connectedMethod.returnType === "boolean") {
          lines.push("");
          lines.push(`if (device.${connectedMethod.name}()) {`);
          lines.push(`  // Device is ready`);
          lines.push(`}`);
        }
        
        lines.push("```");
        lines.push("");
      }
    }
  }
  
  // Type mappings section
  lines.push("## Type Mappings");
  lines.push("");
  lines.push("TypeCode automatically maps Arduino C++ types to TypeScript equivalents:");
  lines.push("");
  lines.push("| Arduino C++ | TypeCode TypeScript |");
  lines.push("|-------------|---------------------|");
  lines.push("| `TwoWire` / `TwoWire*` | `I2C0` |");
  lines.push("| `SPIClass` / `SPIClass*` | `SPI0` |");
  lines.push("| `HardwareSerial` / `HardwareSerial*` | `UART0` |");
  lines.push("| `int`, `uint8_t`, `uint16_t`, etc. | `number` |");
  lines.push("| `float`, `double` | `number` |");
  lines.push("| `bool` | `boolean` |");
  lines.push("| `String`, `const char*` | `string` |");
  lines.push("");
  
  lines.push("## Editing Type Definitions");
  lines.push("");
  lines.push("The generated type definitions are best-effort. You can manually edit the");
  lines.push(`\`node_modules/@types/${libraryName}/index.d.ts\` file to:`);
  lines.push("");
  lines.push("- Add missing methods or properties");
  lines.push("- Fix incorrect type mappings");
  lines.push("- Add JSDoc documentation");
  lines.push("");
  lines.push("To regenerate: delete the file and re-run TypeCode transpile.");
  lines.push("");
  
  return lines.join("\n");
}

/**
 * Clear the library cache (useful for testing or after installing new libraries)
 */
export function clearLibraryCache(): void {
  libraryCache = null;
  cacheTimestamp = 0;
}
