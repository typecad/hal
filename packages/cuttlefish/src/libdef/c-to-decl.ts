/**
 * C-header to TypeScript declaration generator.
 *
 * Complements cpp-to-decl.ts (which is class-focused). ESP-IDF components
 * are mostly C: free functions, opaque handles, typedef'd enums and structs.
 *
 * EMISSION POLICY — names match the C header 1-to-1.
 *
 *   esp_err_t esp_wifi_init(const wifi_config_t *config);
 *
 * becomes
 *
 *   export declare function esp_wifi_init(config: number): esp_err_t;
 *
 * not `esp_wifi.init(...)`. ESP-IDF examples call `esp_wifi_init`, never
 * `esp_wifi.init`; the dotted form has no C++ representation (there is no
 * `esp_wifi` object or namespace in the real header) and would not link.
 * Mirroring the C names verbatim means the transpiler lowers TS calls
 * directly to valid C with zero translation.
 *
 * Spec: docs/superpowers/specs/2026-07-19-demo-wifi-design.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { stripPreprocessorBlocks } from './header-parser.js';

interface CFunction {
  returnType: string;
  name: string;
  params: { type: string; name: string }[];
}

interface CEnumTypedef {
  kind: 'enum';
  name: string;
  values: { name: string; value?: number }[];
}

interface CStructTypedef {
  kind: 'struct';
  name: string;
  fields: { type: string; name: string; isArray: boolean }[];
}

interface COpaqueTypedef {
  kind: 'opaque';
  name: string;
}

interface CAliasTypedef {
  kind: 'alias';
  name: string;
  aliasedType: string;
}

interface CFuncPtrTypedef {
  kind: 'funcptr';
  name: string;
}

type CTypedef = CEnumTypedef | CStructTypedef | COpaqueTypedef | CAliasTypedef | CFuncPtrTypedef;

interface CHeader {
  functions: CFunction[];
  typedefs: CTypedef[];
  defines: { name: string; value: string }[];
}

const BUILTIN_TS_TYPES = new Set(['number', 'string', 'boolean', 'void', 'any']);

/**
 * Map a C type string to a TS type string. Pointer types become `number`
 * (handles/opaque addresses) since the transpiler treats C pointers as
 * numbers anyway. Unknown named types are returned as-is so they resolve
 * to a typedef alias emitted by this same header (or fall back to `number`
 * via the alias-emission pass in generateCDecl).
 */
function mapCTypeToTs(cType: string): string {
  let t = cType.trim();
  // Strip leading `const`/`volatile` qualifiers — they don't affect the TS shape.
  t = t.replace(/^(?:const|volatile)\s+/, '');
  const typeMap: Record<string, string> = {
    int: 'number',
    'unsigned int': 'number',
    'unsigned': 'number',
    'short': 'number',
    'unsigned short': 'number',
    'long': 'number',
    'unsigned long': 'number',
    'long long': 'number',
    'unsigned long long': 'number',
    uint8_t: 'number',
    uint16_t: 'number',
    uint32_t: 'number',
    uint64_t: 'number',
    int8_t: 'number',
    int16_t: 'number',
    int32_t: 'number',
    int64_t: 'number',
    size_t: 'number',
    ssize_t: 'number',
    intptr_t: 'number',
    uintptr_t: 'number',
    float: 'number',
    double: 'number',
    bool: 'boolean',
    _Bool: 'boolean',
    void: 'void',
    char: 'number',
  };
  if (typeMap[t]) return typeMap[t];
  // Strip a trailing pointer; pointers are number-typed handles/addresses.
  if (t.endsWith('*')) return 'number';
  return t;
}

/** Parse function signatures like `esp_err_t foo(int x, const char *y);`. */
function parseFunctions(stripped: string): CFunction[] {
  const fns: CFunction[] = [];
  const fnRegex = /^([\w\s\*]+?)\s+(\w+)\s*\(([^;]*)\)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = fnRegex.exec(stripped)) !== null) {
    const returnType = m[1].trim();
    const name = m[2];
    const paramsRaw = m[3].trim();
    // Skip non-function declarations these regexes might catch.
    if (returnType === 'typedef' || returnType === 'struct' || returnType === 'enum') continue;
    if (returnType === 'static' || returnType === 'extern' || returnType === 'inline') continue;
    if (name === 'if' || name === 'for' || name === 'while' || name === 'return' || name === 'switch') continue;
    fns.push({ returnType, name, params: parseParams(paramsRaw) });
  }
  return fns;
}

function parseParams(raw: string): { type: string; name: string }[] {
  if (!raw || raw === 'void') return [];
  return raw.split(',').map((part, idx) => {
    let trimmed = part.trim();
    trimmed = trimmed.split('=')[0].trim();
    if (!trimmed) return { type: '', name: `_arg${idx}` };
    // C array declarator on a parameter: `<type> <name>[<size>]` or `<type> <name>[]`.
    // Normalize: the array decays to a pointer in C anyway, so we record the
    // base type and the original name. e.g. `uint8_t mac[6]` → type="uint8_t",
    // name="mac"; `uint8_t mac[]` → same.
    const arrParam = trimmed.match(/^(.*?)\b(\w+)\s*\[[^\]]*\]\s*$/);
    if (arrParam) {
      const type = arrParam[1].trim();
      // If the type is empty (e.g. bare `mac[6]` with no preceding type),
      // fall through to the default parser rather than emitting a bogus type.
      if (type) return { type, name: arrParam[2] };
    }
    // A parameter is `<type> <name>` where name is the trailing identifier
    // and type is everything before. For function-pointer params (rare in
    // user-facing IDF APIs) we fall back to treating the whole thing as a
    // type with a synthesized name.
    if (trimmed.includes('(*)')) {
      return { type: trimmed, name: `_arg${idx}` };
    }
    const m = trimmed.match(/^(.*?)(\b\w+)$/);
    if (!m) return { type: trimmed, name: `_arg${idx}` };
    let type = m[1].trim();
    const name = m[2];
    // If the regex left the * glued to the name, pull it back to the type.
    if (!type && trimmed.includes('*')) {
      type = '*';
    }
    return { type: type || trimmed, name };
  });
}

/** Parse typedef'd enums: `typedef enum { A, B=2, C } foo_t;`. */
function parseEnumTypedefs(stripped: string): CEnumTypedef[] {
  const tds: CEnumTypedef[] = [];
  const re = /typedef\s+enum\s*(?:\w+\s*)?\{([^}]*)\}\s*(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const body = m[1];
    const name = m[2];
    const members = body.split(',').map((s) => s.trim()).filter(Boolean);
    let next = 0;
    const values = members.map((mem) => {
      const eq = mem.indexOf('=');
      if (eq >= 0) {
        const val = parseInt(mem.slice(eq + 1).trim(), 10);
        if (!Number.isNaN(val)) next = val + 1;
        return { name: mem.slice(0, eq).trim(), value: Number.isNaN(val) ? undefined : val };
      }
      const v = next++;
      return { name: mem, value: v };
    });
    tds.push({ kind: 'enum', name, values });
  }
  return tds;
}

/** Parse typedef'd structs: `typedef struct { int x; } foo_t;` or
 *  `typedef struct foo { int x; } foo_t;`. Handles array fields
 *  (`int arr[6]`) by recording the array-ness on the field. */
function parseStructTypedefs(stripped: string): CStructTypedef[] {
  const tds: CStructTypedef[] = [];
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
        // Array field: `<type> <name>[<size>]` → name + isArray.
        const arr = field.match(/^(.*?)\b(\w+)\s*\[[^\]]*\]\s*$/);
        if (arr) {
          return { type: arr[1].trim() || field, name: arr[2], isArray: true };
        }
        const pm = field.match(/^(.*?)(\b\w+)$/);
        if (!pm) return { type: field, name: `_f${idx}`, isArray: false };
        return { type: pm[1].trim() || field, name: pm[2], isArray: false };
      });
    tds.push({ kind: 'struct', name, fields });
  }
  return tds;
}

/** Parse opaque handle typedefs: `typedef struct foo *foo_handle_t;`. */
function parseOpaqueTypedefs(stripped: string): COpaqueTypedef[] {
  const tds: COpaqueTypedef[] = [];
  const re = /typedef\s+struct\s+\w+\s*\*\s*(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    tds.push({ kind: 'opaque', name: m[1] });
  }
  return tds;
}

/** Parse function-pointer typedefs: `typedef void (*handler_t)(void *arg);`.
 *  Emits as `any` — TS has no faithful representation of a C function pointer,
 *  and IDF user code that registers one needs `rawCpp()` anyway. */
function parseFuncPtrTypedefs(stripped: string): CFuncPtrTypedef[] {
  const tds: CFuncPtrTypedef[] = [];
  const re = /typedef\s+[\w\s\*]+?\(\s*\*\s*(\w+)\s*\)\s*\([^;]*\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    tds.push({ kind: 'funcptr', name: m[1] });
  }
  return tds;
}

/** Parse plain alias typedefs: `typedef int esp_err_t;`, `typedef uint32_t foo_t;`.
 *  These are extremely common in ESP-IDF (esp_err_t, TickType_t, etc.). */
function parseAliasTypedefs(stripped: string): CAliasTypedef[] {
  const tds: CAliasTypedef[] = [];
  // `typedef <type> <name>;` where <type> is a single token (possibly with
  // qualifiers) and <name> is the alias. Struct/enum/funcptr typedefs are
  // handled by their own parsers, so exclude those keywords here.
  const re = /typedef\s+(?!struct\b)(?!enum\b)(?!union\b)([\w\s\*]+?)\s+(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const aliasedType = m[1].trim();
    const name = m[2];
    // Skip if this is actually the tail of a struct/enum/funcptr typedef that
    // a sibling parser already consumed (defensive — the negative lookahead
    // should already exclude those, but the regex can still match fragments
    // inside a `typedef struct { ... } foo_t;` body in edge cases).
    if (aliasedType === '' || aliasedType.includes('{')) continue;
    // Skip array typedefs: `typedef uint8_t mac[6];` is NOT a plain alias.
    // It would parse as aliasedType="uint8_t" name="mac" with the regex, but
    // the trailing `[6]` between name and `;` makes it an array typedef — the
    // regex's `\s*;` lookahead fails to match `[6];`, so this branch only
    // fires for true plain aliases. Defensive: bail if the captured aliasedType
    // somehow contains a `[` (would indicate a parse fragment).
    if (aliasedType.includes('[')) continue;
    tds.push({ kind: 'alias', name, aliasedType });
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
      ...parseFuncPtrTypedefs(stripped),
      ...parseAliasTypedefs(stripped),
    ],
    defines: parseSimpleDefines(noComments),
  };
}

function emitEnumTypedef(td: CEnumTypedef): string[] {
  const literalUnion = td.values.every((v) => typeof v.value === 'number')
    ? td.values.map((v) => v.value!).join(' | ')
    : 'number';
  const lines = [`export type ${td.name} = ${literalUnion};`];
  // Export named constants so user code can reference WIFI_MODE_STA directly,
  // exactly as ESP-IDF examples do.
  for (const v of td.values) {
    lines.push(`export const ${v.name}: ${td.name} = ${v.value ?? 0};`);
  }
  return lines;
}

function emitStructTypedef(td: CStructTypedef): string[] {
  const fields = td.fields.map((f) => {
    const tsType = mapCTypeToTs(f.type);
    return `  ${f.name}: ${f.isArray ? `${tsType}[]` : tsType};`;
  });
  return [`export interface ${td.name} {`, ...fields, `}`];
}

function emitTypedef(td: CTypedef): string[] {
  switch (td.kind) {
    case 'enum':
      return emitEnumTypedef(td);
    case 'struct':
      return emitStructTypedef(td);
    case 'opaque':
      return [`export type ${td.name} = number;`];
    case 'alias':
      return [`export type ${td.name} = ${mapCTypeToTs(td.aliasedType)};`];
    case 'funcptr':
      // Function-pointer typedefs have no faithful TS representation. Emit
      // `any` with a comment so users know to use `rawCpp()` for callbacks.
      return [
        `// ${td.name} is a C function-pointer typedef; TS has no faithful representation.`,
        `export type ${td.name} = any;`,
      ];
  }
}

/** Emit a free function declaration, name matching the C header 1-to-1. */
function emitFunction(fn: CFunction): string {
  const params = fn.params.map((p, idx) => {
    const name = p.name || `_arg${idx}`;
    const tsType = p.type === '' ? 'any' : mapCTypeToTs(p.type);
    return `${name}: ${tsType}`;
  });
  const returnType = mapCTypeToTs(fn.returnType);
  return `export declare function ${fn.name}(${params.join(', ')}): ${returnType};`;
}

/**
 * Top-level entry: read a header file, write `<header>.d.ts` alongside it.
 * Returns the output path, or null if no declarations could be extracted.
 */
export function generateCDecl(filePath: string, outputPath?: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const header = parseHeader(content);

  // Collect every type name the header defines so the alias-emission pass
  // below doesn't emit spurious `export type X = number;` for types that
  // are already declared.
  const knownTypes = new Set<string>([
    ...header.typedefs.map((t) => t.name),
    ...BUILTIN_TS_TYPES,
  ]);

  // Find referenced types that aren't declared anywhere in this header and
  // aren't builtins — emit them as `export type X = number;` so the .d.ts
  // compiles standalone. (Common case: a header references `esp_err_t` from
  // another header without re-typedef'ing it.)
  const referencedTypes = new Set<string>();
  for (const f of header.functions) {
    referencedTypes.add(mapCTypeToTs(f.returnType));
    for (const p of f.params) referencedTypes.add(mapCTypeToTs(p.type));
  }
  for (const td of header.typedefs) {
    if (td.kind === 'struct') {
      for (const f of td.fields) referencedTypes.add(mapCTypeToTs(f.type));
    } else if (td.kind === 'alias') {
      referencedTypes.add(mapCTypeToTs(td.aliasedType));
    }
  }
  const aliasesToEmit = [...referencedTypes].filter(
    (t) => !knownTypes.has(t) && !t.includes('|') && !BUILTIN_TS_TYPES.has(t),
  );

  // Nothing to emit → tell the caller.
  if (
    header.functions.length === 0 &&
    header.typedefs.length === 0 &&
    header.defines.length === 0 &&
    aliasesToEmit.length === 0
  ) {
    return null;
  }

  const lines: string[] = [
    '// Auto-generated by typecad-hal gen-decls. Do not edit.',
    '// Source: ' + path.basename(filePath),
    '// C names are preserved verbatim; calls lower 1-to-1 to the C header.',
    '',
  ];

  // Standalone type aliases for cross-header references (e.g. esp_err_t).
  for (const a of aliasesToEmit) {
    lines.push(`export type ${a} = number;`);
  }
  if (aliasesToEmit.length > 0) lines.push('');

  // Typedefs (enums, structs, opaque handles, aliases, function pointers).
  for (const td of header.typedefs) {
    lines.push(...emitTypedef(td), '');
  }

  // #define constants (integer/string literals only).
  for (const d of header.defines) {
    lines.push(
      `export const ${d.name}: ${/^"/.test(d.value) ? 'string' : 'number'} = ${d.value};`,
    );
  }
  if (header.defines.length > 0) lines.push('');

  // Free functions, named 1-to-1 with the C header.
  for (const fn of header.functions) {
    lines.push(emitFunction(fn));
  }

  const outPath = outputPath ?? filePath.replace(/\.h$/i, '.d.ts');
  const outContent = lines.join('\n') + '\n';
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, 'utf8') !== outContent) {
    fs.writeFileSync(outPath, outContent, 'utf8');
  }
  return outPath;
}
