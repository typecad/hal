import path from "node:path";

function stripExtension(fileName: string): string {
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

const C_STDLIB_RESERVED_NAMES = new Set([
  "abort", "abs", "acos", "asin", "atan", "atan2",
  "atexit", "atof", "atoi", "atol",
  "calloc", "ceil", "clearerr", "clock", "cos", "cosh", "ctime",
  "div", "exit", "exp",
  "fabs", "fclose", "feof", "ferror", "fflush", "fgetc", "fgetpos", "fgets",
  "floor", "fmod", "fopen", "fprintf", "fputc", "fputs", "fread", "free",
  "freopen", "frexp", "fscanf", "fseek", "fsetpos", "ftell", "fwrite",
  "getc", "getchar", "getenv", "gets", "gmtime",
  "isalnum", "isalpha", "iscntrl", "isdigit", "isgraph", "islower",
  "isprint", "ispunct", "isspace", "isupper", "isxdigit",
  "labs", "ldexp", "ldiv", "localtime", "log", "log10", "longjmp",
  "malloc", "memchr", "memcmp", "memcpy", "memmove", "memset", "mktime", "modf",
  "perror", "pow", "printf", "putc", "putchar", "puts",
  "qsort",
  "raise", "rand", "realloc", "remove", "rename", "rewind",
  "scanf", "setbuf", "setjmp", "setvbuf", "signal", "sin", "sinh", "sprintf",
  "sqrt", "srand", "sscanf", "strcat", "strchr", "strcmp", "strcoll",
  "strcpy", "strcspn", "strerror", "strftime", "strlen", "strncat", "strncmp",
  "strncpy", "strpbrk", "strrchr", "strspn", "strstr", "strtod", "strtok",
  "strtol", "strtoul", "strxfrm", "system",
  "tan", "tanh", "time", "tmpfile", "tmpnam", "tolower", "toupper",
  "ungetc",
  "va_arg", "va_end", "va_start",
  "vfprintf", "vprintf", "vsprintf",
]);

/**
 * Escapes a name that conflicts with a C++ reserved keyword by appending `_`.
 * Additionally checks against the optional `platformNames` set, which should
 * come from `PlatformStrategy.reservedNames()` for the active framework.
 *
 * For example, `register` → `register_`.
 * With Arduino strategy: `min` → `min_`, `map` → `map_`.
 */
export function escapeCppKeyword(name: string, platformNames?: ReadonlySet<string>): string {
  if (CPP_RESERVED_KEYWORDS.has(name)) {
    return `${name}_`;
  }
  if (C_STDLIB_RESERVED_NAMES.has(name)) {
    return `${name}_`;
  }
  if (platformNames?.has(name)) {
    return `${name}_`;
  }
  return name;
}

/**
 * Escape the trailing member name of a (possibly compound) C++ lvalue/access
 * string against the reserved-name sets. Handles both bare identifiers
 * (`min` → `min_`) and member-access chains (`this->min`, `obj.min`,
 * `ptr->field`) by renaming only the final segment, so a reserved member name
 * is escaped consistently with how the field is DECLARED (renameStructField /
 * escapeCppKeyword applied to the bare field name). Demo #33: applying plain
 * escapeCppKeyword to the compound string `this.min` left `min` untouched,
 * diverging from the access path and producing a declaration/access mismatch.
 */
export function escapeTrailingMember(text: string, platformNames?: ReadonlySet<string>): string {
  // A member-access chain ends in `->name`, `.name`, or `::name`. Rename only
  // the trailing identifier so the receiver chain is preserved verbatim.
  const match = text.match(/^(.*?(?:->|\.|::))([A-Za-z_][A-Za-z0-9_]*)$/);
  if (match) {
    const [, prefix, member] = match;
    return `${prefix}${escapeCppKeyword(member, platformNames)}`;
  }
  // No member-access separator — treat the whole text as a bare identifier.
  return escapeCppKeyword(text, platformNames);
}

export function escapeCppStringLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/** Escape a literal text fragment destined for a snprintf *format* string.
 *  Same as escapeCppStringLiteral, but also doubles `%` so a trailing or
 *  embedded percent (e.g. `meter: ${v}%`) doesn't get misread as a conversion
 *  specifier on hardware. Use this for any fragment that becomes part of the
 *  format argument to snprintf(...) — NOT for snprintf *arguments* or for
 *  standalone C++ string literals, where a bare `%` is harmless. */
export function escapeSnprintfFormatFragment(value: string): string {
  return escapeCppStringLiteral(value).replace(/%/g, "%%");
}
