/**
 * C-header to TypeScript declaration generator.
 *
 * Complements cpp-to-decl.ts (which is class-focused). ESP-IDF components
 * are mostly C: free functions, opaque handles, typedef'd enums and structs.
 * The natural TS shape is a namespace of free functions, not a class.
 *
 * Spec: docs/superpowers/specs/2026-07-19-framework-esp32-components-design.md
 *       (Layer 4 — "Emission — C component flavor").
 */

import fs from 'node:fs';
import path from 'node:path';
import { stripPreprocessorBlocks } from './header-parser.js';

interface CFunction {
  returnType: string;
  name: string;
  params: { type: string; name: string }[];
}

interface CTypedef {
  name: string;
  kind: 'enum' | 'struct' | 'opaque';
  // enum
  enumValues?: { name: string; value?: number }[];
  // struct
  fields?: { type: string; name: string }[];
}

interface CHeader {
  functions: CFunction[];
  typedefs: CTypedef[];
  defines: { name: string; value: string }[];
}

/** Map a C primitive/known type to TS. Mirrors cpp-to-decl's mapCppTypeToTs. */
function mapCTypeToTs(cType: string): string {
  const trimmed = cType.trim().replace(/^const\s+/, '');
  const typeMap: Record<string, string> = {
    int: 'number',
    'unsigned int': 'number',
    uint8_t: 'number',
    uint16_t: 'number',
    uint32_t: 'number',
    int8_t: 'number',
    int16_t: 'number',
    int32_t: 'number',
    size_t: 'number',
    float: 'number',
    double: 'number',
    bool: 'boolean',
    void: 'void',
    char: 'number',
  };
  if (typeMap[trimmed]) return typeMap[trimmed];
  // Pointer (with or without leading const): treat as number (handle).
  // Handles cases like "device_handle_t *", "const device_config_t *".
  const noConst = trimmed.replace(/^const\s+/, '');
  if (noConst.endsWith('*')) return 'number';
  return trimmed; // unknown — keep the name (resolves to a typedef alias if present)
}

/** Parse function signatures like `esp_err_t foo(int x, const char *y);`. */
function parseFunctions(stripped: string): CFunction[] {
  const fns: CFunction[] = [];
  // Match: <returnType> <name>(<params>);
  // returnType can include * and const; name is an identifier; params are comma-separated.
  const fnRegex = /^([\w\s\*]+?)\s+(\w+)\s*\(([^;]*)\)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = fnRegex.exec(stripped)) !== null) {
    const returnType = m[1].trim();
    const name = m[2];
    const paramsRaw = m[3].trim();
    // Skip typedef/struct/enum declarations — handled elsewhere.
    if (returnType === 'typedef' || returnType === 'struct' || returnType === 'enum') continue;
    // Skip control-flow keywords that might match (defensive).
    if (name === 'if' || name === 'for' || name === 'while' || name === 'return') continue;
    const params = parseParams(paramsRaw);
    fns.push({ returnType, name, params });
  }
  return fns;
}

function parseParams(raw: string): { type: string; name: string }[] {
  if (!raw || raw === 'void') return [];
  return raw.split(',').map((part, idx) => {
    let trimmed = part.trim();
    // Strip default values (rare in C, but the C++ path handles them).
    trimmed = trimmed.split('=')[0].trim();
    // Last identifier is the name; everything before is the type.
    // For "const char *y", type="const char *", name="y".
    // For "int x", type="int", name="x".
    const m = trimmed.match(/^(.*?)(\b\w+)$/);
    if (!m) return { type: trimmed, name: `_arg${idx}` };
    let type = m[1].trim();
    const name = m[2];
    // If the regex left the * glued to the name, pull it back to the type.
    // e.g. "device_handle_t*h" wouldn't normally occur, but be defensive.
    if (!type && trimmed.includes('*')) {
      type = '*';
    }
    return { type: type || trimmed, name };
  });
}

/** Parse typedef'd enums: `typedef enum { A, B=2, C } foo_t;` */
function parseEnumTypedefs(stripped: string): CTypedef[] {
  const tds: CTypedef[] = [];
  const re = /typedef\s+enum\s*\{([^}]*)\}\s*(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const body = m[1];
    const name = m[2];
    const members = body.split(',').map((s) => s.trim()).filter(Boolean);
    let next = 0;
    const enumValues = members.map((mem) => {
      const eq = mem.indexOf('=');
      if (eq >= 0) {
        const val = parseInt(mem.slice(eq + 1).trim(), 10);
        if (!Number.isNaN(val)) next = val + 1;
        return { name: mem.slice(0, eq).trim(), value: Number.isNaN(val) ? undefined : val };
      }
      const v = next++;
      return { name: mem, value: v };
    });
    tds.push({ name, kind: 'enum', enumValues });
  }
  return tds;
}

/** Parse typedef'd structs: `typedef struct { int x; } foo_t;` */
function parseStructTypedefs(stripped: string): CTypedef[] {
  const tds: CTypedef[] = [];
  const re = /typedef\s+struct\s*(?:\w+\s*)?\{([^}]*)\}\s*(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const body = m[1];
    const name = m[2];
    const fields = body
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((field, idx) => {
        const pm = field.match(/^(.*?)(\b\w+)$/);
        if (!pm) return { type: field, name: `_f${idx}` };
        return { type: pm[1].trim() || field, name: pm[2] };
      });
    tds.push({ name, kind: 'struct', fields });
  }
  return tds;
}

/** Parse opaque handle typedefs: `typedef struct foo *foo_handle_t;` */
function parseOpaqueTypedefs(stripped: string): CTypedef[] {
  const tds: CTypedef[] = [];
  const re = /typedef\s+struct\s+\w+\s*\*\s*(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    tds.push({ name: m[1], kind: 'opaque' });
  }
  return tds;
}

/** Parse `#define FOO 42` and `#define BAR "str"` (integers and strings only). */
function parseSimpleDefines(content: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const re = /^\s*#define\s+(\w+)\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    const value = m[2].trim();
    // Only keep simple integer or string literals.
    if (/^-?\d+$/.test(value) || /^"[^"]*"$/.test(value)) {
      out.push({ name, value });
    }
  }
  return out;
}

// Strip C-style comments so they don't interfere with parsing.
// Block comments and line comments are both removed; preprocessor
// directives are preserved (stripPreprocessorBlocks handles those next).
function stripComments(content: string): string {
  // Remove block comments (non-greedy, multiline) then line comments.
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function parseHeader(content: string): CHeader {
  const noComments = stripComments(content);
  const stripped = stripPreprocessorBlocks(noComments);
  return {
    functions: parseFunctions(stripped),
    typedefs: [
      ...parseEnumTypedefs(stripped),
      ...parseStructTypedefs(stripped),
      ...parseOpaqueTypedefs(stripped),
    ],
    defines: parseSimpleDefines(noComments),
  };
}

/**
 * Derive the namespace name from the longest common prefix of all function
 * names that ends at an underscore boundary.
 *
 * For [esp_wifi_init, esp_wifi_set_mode] the common prefix is "esp_wifi_";
 * we return "esp_wifi" and stripPrefix turns "esp_wifi_init" → "init".
 *
 * Falls back to the first underscore segment of the first function when no
 * common multi-segment prefix exists, and to the bare first name when there
 * are no underscores at all.
 */
function deriveNamespace(functions: CFunction[]): string {
  if (functions.length === 0) return '';
  const names = functions.map((f) => f.name);
  // Find the longest common prefix across all names.
  let prefixLen = names[0].length;
  for (let i = 1; i < names.length; i++) {
    let j = 0;
    while (j < prefixLen && j < names[i].length && names[0][j] === names[i][j]) j++;
    prefixLen = j;
  }
  let prefix = names[0].slice(0, prefixLen);
  // Trim back to the last underscore so we don't cut mid-token.
  // e.g. common prefix "esp_wifi_i" (init vs set_mode diverge at index 9)
  // trims to "esp_wifi".
  const lastUnderscore = prefix.lastIndexOf('_');
  if (lastUnderscore > 0) {
    prefix = prefix.slice(0, lastUnderscore);
  }
  if (prefix) return prefix;
  // No shared underscore-bounded prefix: fall back to the first function's
  // first underscore segment (or its whole name if no underscore).
  const first = names[0];
  const firstUnder = first.indexOf('_');
  return firstUnder > 0 ? first.slice(0, firstUnder) : first;
}

/** Strip the namespace prefix from a function name: `esp_wifi_init` → `init`. */
function stripPrefix(fnName: string, ns: string): string {
  return fnName.startsWith(ns + '_') ? fnName.slice(ns.length + 1) : fnName;
}

function emitTypedef(td: CTypedef): string[] {
  switch (td.kind) {
    case 'enum': {
      const vals = td.enumValues ?? [];
      const literalUnion = vals.every((v) => typeof v.value === 'number')
        ? vals.map((v) => v.value!).join(' | ')
        : 'number';
      const lines = [`export type ${td.name} = ${literalUnion};`];
      // Also export named constants so user code can reference WIFI_MODE_STA.
      for (const v of vals) {
        lines.push(`export const ${v.name}: ${td.name} = ${v.value ?? 0};`);
      }
      return lines;
    }
    case 'struct': {
      const fields = (td.fields ?? []).map((f) => `  ${f.name}: ${mapCTypeToTs(f.type)};`);
      return [`export interface ${td.name} {`, ...fields, `}`];
    }
    case 'opaque':
      return [`export type ${td.name} = number;`];
  }
}

function emitNamespace(ns: string, fns: CFunction[]): string[] {
  const methods = fns.map((f) => {
    const params = f.params.map(
      (p, idx) => `${p.name || `_arg${idx}`}: ${mapCTypeToTs(p.type)}`,
    );
    return `  ${stripPrefix(f.name, ns)}(${params.join(', ')}): ${mapCTypeToTs(f.returnType)};`;
  });
  return [`export declare const ${ns}: {`, ...methods, `};`];
}

/**
 * Top-level entry: read a header file, write `<header>.d.ts` alongside it.
 * Returns the output path, or null if no declarations could be extracted.
 */
export function generateCDecl(filePath: string, outputPath?: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const header = parseHeader(content);

  // Collect known type names so we can decide which referenced types need an alias.
  const knownTypes = new Set<string>([
    ...header.typedefs.map((t) => t.name),
    'number',
    'string',
    'boolean',
    'void',
    'any',
  ]);
  const referencedTypes = new Set<string>();
  for (const f of header.functions) {
    referencedTypes.add(mapCTypeToTs(f.returnType));
    for (const p of f.params) referencedTypes.add(mapCTypeToTs(p.type));
  }
  // Emit `export type X = number;` for unknown, non-union referenced types.
  const builtins = /^(number|string|boolean|void|any)$/;
  const aliasesToEmit = [...referencedTypes].filter(
    (t) => !knownTypes.has(t) && !t.includes('|') && !builtins.test(t),
  );

  // If there's nothing to emit, signal that to the caller.
  if (
    header.functions.length === 0 &&
    header.typedefs.length === 0 &&
    header.defines.length === 0 &&
    aliasesToEmit.length === 0
  ) {
    return null;
  }

  const lines: string[] = [
    '// Auto-generated by cuttlefish gen-decls. Do not edit.',
    '// Source: ' + path.basename(filePath),
    '',
  ];

  for (const a of aliasesToEmit) {
    lines.push(`export type ${a} = number;`);
  }

  for (const td of header.typedefs) lines.push(...emitTypedef(td), '');

  for (const d of header.defines) {
    lines.push(
      `export const ${d.name}: ${/^"/.test(d.value) ? 'string' : 'number'} = ${d.value};`,
    );
  }
  if (header.defines.length > 0) lines.push('');

  const ns = deriveNamespace(header.functions);
  if (ns && header.functions.length > 0) {
    lines.push(...emitNamespace(ns, header.functions));
  }

  const outPath = outputPath ?? filePath.replace(/\.h$/i, '.d.ts');
  const outContent = lines.join('\n') + '\n';
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, 'utf8') !== outContent) {
    fs.writeFileSync(outPath, outContent, 'utf8');
  }
  return outPath;
}
