/**
 * C++ to TypeScript Declaration Generator
 * 
 * Parses simple C++ class definitions and generates .d.ts declaration files
 * for use with TypeCAD's native module support.
 */

import fs from "node:fs";
import path from "node:path";
import { parseHeader, type ParsedClass } from "./header-parser.js";
import { buildClassIndex, BaseClassResolver } from "./base-class-resolver.js";

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
  baseClass?: string;
  source: "header" | "cpp";
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
      // C++ lets pointer/reference markers attach to either the type
      // (`char* label`) or the name (`char *label`), and arrays appear as a
      // trailing `[]` on the name. Peel leading `*`/`&` and trailing `[]`
      // off the name token back onto the type, so the emitted name is a
      // valid TS identifier and the type still routes through
      // mapCppTypeToTs (which maps pointers/refs appropriately).
      let name = tokens[tokens.length - 1];
      const typeParts = tokens.slice(0, -1);
      const prefix: string[] = [];
      while (/^[*&]/.test(name)) {
        prefix.push(name[0]);
        name = name.slice(1);
      }
      let arrayMarker = "";
      if (/\[\]$/.test(name)) {
        arrayMarker = "*";
        name = name.replace(/\[\]$/, "");
      }
      if (prefix.length > 0 || arrayMarker) {
        typeParts.push(prefix.join("") + arrayMarker);
      }
      const type = typeParts.join(" ").trim();
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
        source: "cpp",
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
      source: "cpp",
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
    const extendsClause = cppClass.baseClass ? ` extends ${cppClass.baseClass}` : "";
    lines.push(`export declare class ${cppClass.name}${extendsClause} {`);
    
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
 * Backward-compat wrapper — delegates to generateDecl so legacy callers
 * (e.g. cli.ts) keep resolving while the richer .h/.cpp merge lives in
 * generateDecl.
 */
export function generateDeclFromCpp(cppFilePath: string, outputPath?: string): string | null {
  return generateDecl(cppFilePath, outputPath);
}

/**
 * Scans a directory for .h and .cpp files and generates .d.ts files.
 *
 * Two passes:
 *   1. Build a class-name → header-path index from all .h under dir.
 *   2. For each .h (and .cpp with no sibling .h), parse + merge + emit with
 *      cross-file base resolution.
 */
export function generateDeclsForDirectory(dir: string, recursive: boolean = true): string[] {
  const created: string[] = [];
  if (!fs.existsSync(dir)) {
    return created;
  }

  const index = buildClassIndex(dir);
  const resolver = new BaseClassResolver(index);

  const walk = (d: string) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && recursive) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".h")) {
        const r = generateDeclWithResolver(full, resolver);
        if (r) created.push(r);
      } else if (lower.endsWith(".cpp")) {
        // Skip .cpp files that have a sibling .h — the .h drives emission.
        const cppBase = path.basename(full, ".cpp");
        const siblingH = path.join(path.dirname(full), cppBase + ".h");
        if (!fs.existsSync(siblingH)) {
          const r = generateDeclWithResolver(full, resolver);
          if (r) created.push(r);
        }
      }
    }
  };
  walk(dir);
  return created;
}
/**
 * Generates a .d.ts from a .h OR .cpp file.
 *
 * - For .h: parses the header; if a sibling .cpp exists, merges its
 *   impl-only methods (ClassName::method) into the header's classes.
 * - For .cpp: if a sibling .h exists, parses the header and merges; else
 *   behaves as the legacy flattened path.
 *
 * Does NOT resolve cross-file base classes — bases from other headers are
 * left as bare `extends Foo` (no import). Cross-file resolution is added in
 * a later step for the directory-scan path.
 */
export function generateDecl(filePath: string, outputPath?: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  const baseNoExt = path.basename(filePath, ext);

  let headerPath: string | undefined;
  let cppPath: string | undefined;
  if (ext === ".h") {
    headerPath = filePath;
    const siblingCpp = path.join(dir, baseNoExt + ".cpp");
    cppPath = fs.existsSync(siblingCpp) ? siblingCpp : undefined;
  } else if (ext === ".cpp") {
    cppPath = filePath;
    const siblingH = path.join(dir, baseNoExt + ".h");
    headerPath = fs.existsSync(siblingH) ? siblingH : undefined;
  } else {
    return null;
  }

  let headerClasses: ParsedClass[] = [];
  if (headerPath) {
    headerClasses = parseHeader(fs.readFileSync(headerPath, "utf8"));
  }
  let cppResult: CppParseResult = { classes: [], constants: [] };
  if (cppPath) {
    cppResult = parseCppClass(fs.readFileSync(cppPath, "utf8"));
  }

  const merged: CppClass[] = [];
  const byName = new Map<string, CppClass>();
  for (const h of headerClasses) {
    const cls: CppClass = {
      name: h.name,
      methods: [...h.methods],
      constructors: [...h.constructors],
      baseClass: h.baseClass,
      source: "header",
    };
    byName.set(h.name, cls);
    merged.push(cls);
  }
  for (const c of cppResult.classes) {
    const existing = byName.get(c.name);
    if (existing) {
      for (const m of c.methods) {
        if (!existing.methods.some(em => em.name === m.name)) {
          existing.methods.push(m);
        }
      }
    } else if (!headerPath) {
      // No sibling header: keep .cpp-inferred classes (legacy flattened path).
      // When a header IS present, drop .cpp-only classes — they belong to
      // other headers and would otherwise create false "same-file" bases
      // (e.g. Adafruit_SPITFT inferred from Adafruit_ILI9341.cpp's
      // Adafruit_SPITFT::readcommand8 scope resolution).
      merged.push({ ...c, source: "cpp" });
    }
  }

  if (merged.length === 0 && cppResult.constants.length === 0) {
    return null;
  }

  // Single-file mode: no resolver → all cross-file bases are "external" →
  // emitted as empty stubs so the .d.ts still compiles standalone.
  const declaration = generateDeclarationWithResolver(
    { classes: merged, constants: cppResult.constants },
    new BaseClassResolver(new Map()),
    filePath,
  );

  const outPath = outputPath || path.join(dir, baseNoExt + ".d.ts");
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, "utf8") !== declaration) {
    fs.writeFileSync(outPath, declaration, "utf8");
  }
  return outPath;
}

/**
 * Like generateDeclaration, but resolves base classes against `resolver` and
 * the emitting file path (for computing relative import paths).
 *
 * Emission order: imports → constants → stubs → classes.
 */
function generateDeclarationWithResolver(
  parsed: CppParseResult,
  resolver: BaseClassResolver,
  emittingFilePath: string,
): string {
  const lines: string[] = [];
  const importingFrom = new Map<string, string>(); // baseName → POSIX import path
  const stubs = new Set<string>();                  // unresolved base names
  const classNames = new Set(parsed.classes.map(c => c.name));

  // Classify each base.
  for (const cls of parsed.classes) {
    if (!cls.baseClass) continue;
    if (classNames.has(cls.baseClass)) continue; // same-file base
    const r = resolver.resolve(cls.baseClass);
    if (r.kind === "found") {
      const targetDts = r.headerPath.replace(/\.h$/i, ".d.ts");
      const rel = path.relative(path.dirname(emittingFilePath), path.dirname(targetDts));
      const targetBase = path.basename(targetDts, ".d.ts");
      const relPosix = (rel || ".").replace(/\\/g, "/");
      const importPath = relPosix === "." ? `./${targetBase}` : `${relPosix}/${targetBase}`;
      importingFrom.set(cls.baseClass, importPath);
    } else {
      stubs.add(cls.baseClass);
    }
  }

  // Imports.
  for (const [baseName, importPath] of importingFrom) {
    lines.push(`import type { ${baseName} } from "${importPath}";`);
  }
  if (importingFrom.size > 0) lines.push("");

  // Constants.
  for (const constant of parsed.constants) {
    lines.push(`export declare const ${constant.name}: ${constant.type};`);
  }
  if (parsed.constants.length > 0 && parsed.classes.length > 0) lines.push("");

  // Stubs for unresolved bases.
  for (const stub of stubs) {
    lines.push(`declare class ${stub} {}`);
  }
  if (stubs.size > 0) lines.push("");

  // Classes.
  for (const cppClass of parsed.classes) {
    const extendsClause = cppClass.baseClass ? ` extends ${cppClass.baseClass}` : "";
    lines.push(`export declare class ${cppClass.name}${extendsClause} {`);
    for (const ctor of cppClass.constructors) {
      const params = ctor.parameters
        .filter(p => p.name)
        .map(p => `${p.name}: ${p.type}`)
        .join(", ");
      lines.push(`  constructor(${params});`);
    }
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
 * Like generateDecl, but resolves base classes against `resolver`: cross-file
 * bases become `import type`; unresolved bases become empty stubs.
 */
function generateDeclWithResolver(
  filePath: string,
  resolver: BaseClassResolver,
): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  const baseNoExt = path.basename(filePath, ext);

  let headerPath: string | undefined;
  let cppPath: string | undefined;
  if (ext === ".h") {
    headerPath = filePath;
    const siblingCpp = path.join(dir, baseNoExt + ".cpp");
    cppPath = fs.existsSync(siblingCpp) ? siblingCpp : undefined;
  } else if (ext === ".cpp") {
    cppPath = filePath;
    const siblingH = path.join(dir, baseNoExt + ".h");
    headerPath = fs.existsSync(siblingH) ? siblingH : undefined;
  } else {
    return null;
  }

  let headerClasses: ParsedClass[] = [];
  if (headerPath) {
    headerClasses = parseHeader(fs.readFileSync(headerPath, "utf8"));
  }
  let cppResult: CppParseResult = { classes: [], constants: [] };
  if (cppPath) {
    cppResult = parseCppClass(fs.readFileSync(cppPath, "utf8"));
  }

  const merged: CppClass[] = [];
  const byName = new Map<string, CppClass>();
  for (const h of headerClasses) {
    const cls: CppClass = {
      name: h.name,
      methods: [...h.methods],
      constructors: [...h.constructors],
      baseClass: h.baseClass,
      source: "header",
    };
    byName.set(h.name, cls);
    merged.push(cls);
  }
  for (const c of cppResult.classes) {
    const existing = byName.get(c.name);
    if (existing) {
      for (const m of c.methods) {
        if (!existing.methods.some(em => em.name === m.name)) {
          existing.methods.push(m);
        }
      }
    } else if (!headerPath) {
      // No sibling header: keep .cpp-inferred classes (legacy flattened path).
      // When a header IS present, drop .cpp-only classes — they belong to
      // other headers and would otherwise create false "same-file" bases
      // (e.g. Adafruit_SPITFT inferred from Adafruit_ILI9341.cpp's
      // Adafruit_SPITFT::readcommand8 scope resolution).
      merged.push({ ...c, source: "cpp" });
    }
  }

  if (merged.length === 0 && cppResult.constants.length === 0) {
    return null;
  }

  const declaration = generateDeclarationWithResolver(
    { classes: merged, constants: cppResult.constants },
    resolver,
    filePath,
  );

  const outPath = path.join(dir, baseNoExt + ".d.ts");
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, "utf8") !== declaration) {
    fs.writeFileSync(outPath, declaration, "utf8");
  }
  return outPath;
}
