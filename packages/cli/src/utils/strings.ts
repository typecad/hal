import path from "node:path";

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function toModuleKey(moduleSpecifier: string): string {
  const normalized = moduleSpecifier.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);
  return stripExtension(base).toLowerCase();
}

export function toPascalCase(input: string): string {
  return input
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

export function withLineColumn(content: string, position: number): { line: number; column: number } {
  const prefix = content.slice(0, position);
  const lines = prefix.split(/\r?\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

/**
 * C++ reserved keywords that cannot be used as identifiers.
 * When a TypeScript parameter/variable name matches one of these,
 * we append an underscore to avoid compile errors.
 */
const CPP_RESERVED_KEYWORDS = new Set([
  // C keywords also reserved in C++
  "auto", "break", "case", "char", "const", "continue", "default", "do",
  "double", "else", "enum", "extern", "float", "for", "goto", "if",
  "int", "long", "register", "return", "short", "signed", "sizeof",
  "static", "struct", "switch", "typedef", "union", "unsigned", "void",
  "volatile", "while",
  // C++-specific keywords
  "alignas", "alignof", "and", "and_eq", "asm", "atomic_cancel",
  "atomic_commit", "atomic_noexcept", "bitand", "bitor", "bool",
  "catch", "char16_t", "char32_t", "char8_t", "class", "compl",
  "concept", "const_cast", "consteval", "constexpr", "constinit",
  "co_await", "co_return", "co_yield", "decltype", "delete",
  "dynamic_cast", "explicit", "export", "false", "friend", "inline",
  "mutable", "namespace", "new", "noexcept", "not", "not_eq",
  "nullptr", "operator", "or", "or_eq", "private", "protected",
  "public", "reflexpr", "reinterpret_cast", "requires", "static_assert",
  "static_cast", "template", "this", "thread_local", "throw",
  "true", "try", "typedef", "typeid", "typename", "using",
  "virtual", "wchar_t", "xor", "xor_eq",
]);

/**
 * Escapes a name that conflicts with a C++ reserved keyword by appending `_`.
 * For example, `register` → `register_`, `class` → `class_`.
 */
export function escapeCppKeyword(name: string): string {
  if (CPP_RESERVED_KEYWORDS.has(name)) {
    return `${name}_`;
  }
  return name;
}
