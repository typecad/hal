/**
 * C++ to TypeScript Declaration Generator
 * 
 * Parses simple C++ class definitions and generates .d.ts declaration files
 * for use with TypeHAL's native module support.
 */

import fs from "node:fs";
import path from "node:path";

interface CppMethod {
  name: string;
  returnType: string;
  parameters: { type: string; name: string }[];
  isPublic: boolean;
}

interface CppClass {
  name: string;
  methods: CppMethod[];
  constructors: { parameters: { type: string; name: string }[] }[];
}

interface CppParseResult {
  classes: CppClass[];
  constants: { name: string; type: string; value: string }[];
}

/**
 * Maps C++ types to TypeScript types
 */
function mapCppTypeToTs(cppType: string): string {
  const trimmed = cppType.trim();
  
  // Remove const qualifier
  const withoutConst = trimmed.replace(/^const\s+/, "");
  
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
  };
  
  // Check direct mapping
  if (typeMap[withoutConst]) {
    return typeMap[withoutConst];
  }
  
  // Handle pointers (treat as number for simplicity)
  if (withoutConst.endsWith("*")) {
    return "number";
  }
  
  // Handle references
  if (withoutConst.endsWith("&")) {
    const baseType = withoutConst.slice(0, -1).trim();
    return mapCppTypeToTs(baseType);
  }
  
  // Default to any for unknown types
  return "any";
}

/**
 * Extracts the parameter list from a function signature
 */
function parseParameters(paramString: string): { type: string; name: string }[] {
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
      const name = tokens[tokens.length - 1];
      const type = tokens.slice(0, -1).join(" ");
      params.push({ type: mapCppTypeToTs(type), name });
    } else if (tokens.length === 1) {
      // Just a type (unnamed parameter)
      params.push({ type: mapCppTypeToTs(tokens[0]), name: "" });
    }
  }
  
  return params;
}

/**
 * Parses a C++ class definition
 */
function parseCppClass(content: string): CppParseResult {
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
  // This handles cases where the class is defined in a header but implemented in .cpp
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
        isPublic: true, // Assume public for implementation files
      });
    }
  }
  
  // Add inferred classes to result
  for (const cppClass of classesFromImpl.values()) {
    result.classes.push(cppClass);
  }
  
  // Parse class definitions - handle nested braces properly
  // Find class keyword and then find matching closing brace
  const classStartRegex = /\bclass\s+(\w+)\s*\{/g;
  let classStartMatch;
  
  while ((classStartMatch = classStartRegex.exec(content)) !== null) {
    const className = classStartMatch[1];
    const startIndex = classStartMatch.index + classStartMatch[0].length;
    
    // Find matching closing brace
    let braceCount = 1;
    let endIndex = startIndex;
    for (let i = startIndex; i < content.length && braceCount > 0; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') braceCount--;
      endIndex = i;
    }
    
    const classBody = content.slice(startIndex, endIndex);
    
    const cppClass: CppClass = {
      name: className,
      methods: [],
      constructors: [],
    };
    
    // Track current access level
    let isPublic = false;
    
    // Parse declarations within the class body
    // Match constructors and methods: type name(params) or name(params)
    // Need to handle multi-line declarations
    
    // First, normalize whitespace
    const normalizedBody = classBody.replace(/\s+/g, ' ');
    
    // Split by method/constructor definitions (look for patterns ending with { or ;)
    // Pattern: type name(params) { body } or type name(params);
    const methodRegex = /(\w+(?:\s*[*&])?)\s+(\w+)\s*\(([^)]*)\)\s*(?:const\s*)?(?:\{|;)/g;
    let methodMatch;
    
    // Also look for access specifiers
    const accessRegex = /(public|private|protected)\s*:/g;
    
    // Process the class body by scanning for declarations
    let lastIndex = 0;
    const segments: { text: string; isPublic: boolean }[] = [];
    let currentIsPublic = false;
    
    // Split by access specifiers
    const bodyWithAccess = normalizedBody.split(/(public:|private:|protected:)/);
    for (let i = 0; i < bodyWithAccess.length; i++) {
      const segment = bodyWithAccess[i].trim();
      if (segment === 'public:') {
        currentIsPublic = true;
      } else if (segment === 'private:' || segment === 'protected:') {
        currentIsPublic = false;
      } else if (segment) {
        segments.push({ text: segment, isPublic: currentIsPublic });
      }
    }
    
    // Process each segment for methods and constructors
    for (const segment of segments) {
      // Match methods with return type: type name(params)
      const methodMatches = segment.text.matchAll(/(\w+(?:\s*[*&])?)\s+(\w+)\s*\(([^)]*)\)\s*(?:const\s*)?(?:\{|;)/g);
      
      for (const match of methodMatches) {
        const returnType = match[1].trim();
        const name = match[2].trim();
        const params = match[3];
        
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
            isPublic: segment.isPublic,
          });
        }
      }
      
      // Also match constructors without return type: ClassName(params)
      const ctorRegex = new RegExp(`\\b(${className})\\s*\\(([^)]*)\\)\\s*(?:\\{|;)`, 'g');
      const ctorMatches = segment.text.matchAll(ctorRegex);
      
      for (const match of ctorMatches) {
        const params = match[2];
        // Check if we already have this constructor (avoid duplicates)
        const existingCtor = cppClass.constructors.find(c => 
          c.parameters.length === parseParameters(params).length
        );
        if (!existingCtor) {
          cppClass.constructors.push({
            parameters: parseParameters(params),
          });
        }
      }
    }
    
    result.classes.push(cppClass);
  }
  
  return result;
}

/**
 * Generates TypeScript declaration content from parsed C++
 */
function generateDeclaration(parsed: CppParseResult, moduleDocstring?: string): string {
  const lines: string[] = [];
  
  // Add docstring if provided
  if (moduleDocstring) {
    lines.push(`/** ${moduleDocstring} */`);
  }
  
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
  
  return lines.join("\n") + "\n";
}

/**
 * Generates a .d.ts file from a C++ source file
 */
export function generateDeclFromCpp(cppFilePath: string, outputPath?: string): string | null {
  if (!fs.existsSync(cppFilePath)) {
    return null;
  }
  
  const content = fs.readFileSync(cppFilePath, "utf8");
  const parsed = parseCppClass(content);
  
  if (parsed.classes.length === 0 && parsed.constants.length === 0) {
    return null;
  }
  
  const declaration = generateDeclaration(parsed);
  
  // Determine output path
  const outPath = outputPath || cppFilePath.replace(/\.cpp$/i, ".d.ts");
  
  // Only write if file doesn't exist or content is different
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, "utf8") !== declaration) {
    fs.writeFileSync(outPath, declaration, "utf8");
  }
  
  return outPath;
}

/**
 * Scans a directory for .cpp files and generates .d.ts files for each
 */
export function generateDeclsForDirectory(dir: string, recursive: boolean = true): string[] {
  const created: string[] = [];
  
  if (!fs.existsSync(dir)) {
    return created;
  }
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory() && recursive) {
      created.push(...generateDeclsForDirectory(fullPath, recursive));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".cpp")) {
      // Check if .d.ts already exists
      const declPath = fullPath.replace(/\.cpp$/i, ".d.ts");
      if (!fs.existsSync(declPath)) {
        const result = generateDeclFromCpp(fullPath);
        if (result) {
          created.push(result);
        }
      }
    }
  }
  
  return created;
}