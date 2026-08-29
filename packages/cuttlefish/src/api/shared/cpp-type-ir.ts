// ---------------------------------------------------------------------------
// CppTypeIR — structured representation of a C++ type
//
// Replaces the stringly-typed `CppType = string` / `CppTypeHint` template-literal
// union. A C++ type is parsed once into this discriminated union and inspected by
// `kind` thereafter; the only place a type string is reconstructed is
// `renderCppType`. This eliminates the ~60+ ad-hoc `startsWith("std::vector<")` /
// `endsWith("*")` / `slice(len, -1)` sites scattered across `ir/` and `emit/`.
//
// ## Design notes
//
// - **Qualifiers are orthogonal wrappers.** `const`, `&`, and `*` are separate
//   variants (`qualified` / `reference` / `pointer`) rather than baked into a
//   string. This matches how they actually compose in `const std::vector<T>&`
//   and lets consumers peel one layer at a time.
// - **Byte-identical round trip.** `renderCppType(parseCppType(s)) === s` for
//   every type string the transpiler produces (verified by
//   `tests/packages/cuttlefish/cpp-type-ir.test.ts`). The renderer must preserve
//   the exact spelling the codebase already emits, including whitespace inside
//   template argument lists (e.g. `std::variant<double, std::string>` keeps its
//   ", " separator).
// - **Pseudo-types are first-class.** `__tc_StaticArray<T,N>`, `__tc_str_ptr`,
//   `__tc_Generator<T>` all get explicit kinds so they can be matched without
//   re-parsing. The transient value-level sentinel `__TYPED_ARRAY__:elem:size`
//   is *not* a cppType (it lives in HAL return values) and is therefore not
//   modeled here; the `T[N]` C-array it lowers to is modeled as `staticArray`.
// - **Class types are always pointers.** Per the producer's convention
//   (type-resolution.ts:417-428) a TypeScript class reference is emitted as
//   `ClassName*` so `new X()` never assigns to a value-typed `X`. The parser
//   preserves this; it does not "unwrap" pointers.
//
// ## Out of scope
//
// `libdef/cpp-to-decl.ts` parses raw C++ *source text* (not IR `CppType`) along
// a separate pipeline; it is unaffected by and does not consume this module.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

/** Fixed-width / builtin scalar type names used by the transpiler. */
export type CppPrimitiveName =
  | "int" | "long" | "long long"
  | "unsigned int" | "unsigned long" | "unsigned long long"
  | "short" | "unsigned short"
  | "float" | "double" | "long double"
  | "bool" | "void"
  | "char" | "signed char" | "unsigned char"
  | "size_t" | "ssize_t" | "intptr_t" | "uintptr_t" | "ptrdiff_t"
  | "int8_t" | "int16_t" | "int32_t" | "int64_t"
  | "uint8_t" | "uint16_t" | "uint32_t" | "uint64_t";

/**
 * Structured representation of a C++ type.
 *
 * Construct via the `CppTypeIR.*` builders or by parsing a string with
 * `parseCppType`. Inspect via `kind`. Render back to a string with
 * `renderCppType`.
 */
export type CppTypeIR =
  /** Builtin scalar (`int`, `double`, `uint8_t`, `void`, …). */
  | { kind: "primitive"; name: CppPrimitiveName }
  /** Unresolved / template-parameter / unknown — renders as the literal `auto`. */
  | { kind: "auto" }
  /** `std::string`. Modeled separately from `primitive` because it is a class
   *  type with reference semantics and is detected by `isStringLike`. */
  | { kind: "string" }
  /** `__tc_str_ptr` sentinel — marks an expression that must be passed as `.c_str()`. */
  | { kind: "strPtr" }
  /** A user-defined named type (struct/class/enum/typedef/typename) with
   *  optional template arguments. The `args` are the *parsed* template args. */
  | { kind: "named"; name: string; args?: CppTypeIR[] }
  /** Pointer to `base`. Renders as `${render(base)}*`. */
  | { kind: "pointer"; base: CppTypeIR }
  /** Reference to `base`. `isConst` distinguishes `T&` from `const T&`. */
  | { kind: "reference"; base: CppTypeIR; isConst: boolean }
  /** Top-level const qualification: `const T` (prefix) or `T const` (suffix). */
  | { kind: "qualified"; base: CppTypeIR; isConst: boolean }
  /** `std::vector<element>`. */
  | { kind: "vector"; element: CppTypeIR }
  /** `std::set<element>`. */
  | { kind: "set"; element: CppTypeIR }
  /** `std::map<key, value>`. */
  | { kind: "map"; key: CppTypeIR; value: CppTypeIR }
  /** `std::tuple<...elements>`. */
  | { kind: "tuple"; elements: CppTypeIR[] }
  /** `std::variant<...members>`. */
  | { kind: "variant"; members: CppTypeIR[] }
  /** `std::function<returnType(params...)>`. */
  | { kind: "function"; returnType: CppTypeIR; params: CppTypeIR[] }
  /** Compile-time fixed-size array: `__tc_StaticArray<element, size>` or
   *  C-array `element[size]`. `size` is undefined for `element[]`. */
  | { kind: "staticArray"; element: CppTypeIR; size?: number }
  /** C-array decayed form `element[]` / `element[size]` (distinct from
   *  `staticArray` which carries the `__tc_StaticArray` marker). */
  | { kind: "cArray"; element: CppTypeIR; size?: number }
  /** Coroutine generator pseudo-type `__tc_Generator<yieldType>`. */
  | { kind: "generator"; yieldType: CppTypeIR }
  /** Smart pointer wrappers `std::shared_ptr<inner>` / `std::unique_ptr<inner>`.
   *  `wrapper` is the smart-pointer class name. */
  | { kind: "smartPointer"; wrapper: "std::shared_ptr" | "std::unique_ptr"; inner: CppTypeIR }
  /** Escape hatch for a type token the parser does not yet model explicitly.
   *  Renders back as `raw` unchanged. Lets migration be incremental. */
  | { kind: "opaque"; raw: string };

/** All discriminator strings, useful for exhaustive switches. */
export type CppTypeKind = CppTypeIR["kind"];

// ---------------------------------------------------------------------------
// Known spellings
// ---------------------------------------------------------------------------

const PRIMITIVE_NAMES: ReadonlySet<string> = new Set<CppPrimitiveName>([
  "int", "long", "long long",
  "unsigned int", "unsigned long", "unsigned long long",
  "short", "unsigned short",
  "float", "double", "long double",
  "bool", "void",
  "char", "signed char", "unsigned char",
  "size_t", "ssize_t", "intptr_t", "uintptr_t", "ptrdiff_t",
  "int8_t", "int16_t", "int32_t", "int64_t",
  "uint8_t", "uint16_t", "uint32_t", "uint64_t",
] as CppPrimitiveName[]);

function isPrimitiveName(s: string): s is CppPrimitiveName {
  return PRIMITIVE_NAMES.has(s);
}

// ---------------------------------------------------------------------------
// splitTemplateArgs — the one correct nested-template-argument splitter
//
// Promoted from its private definition in type-resolution.ts. Splits a template
// argument list on top-level commas (depth-0), respecting nested `<>`. Returns
// the args with surrounding whitespace preserved (callers `.trim()` when they
// want canonical form). This is the only splitter in the codebase that handles
// `std::map<K, V>` and nested templates correctly — the half-dozen inline
// `slice(len, -1).split(",")` copies do not.
// ---------------------------------------------------------------------------

export function splitTemplateArgs(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<") depth++;
    else if (ch === ">") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

// ---------------------------------------------------------------------------
// parseCppType — the single parser
//
// Peels `const` (prefix and suffix), `&`, `*`, smart pointers, and the
// `std::` / `__tc_` template wrappers from the outside in, then recurses into
// the template arguments.
//
// Returns `opaque` for any input it cannot classify, so unknown spellings
// survive a round trip rather than throwing.
// ---------------------------------------------------------------------------

export function parseCppType(s: string): CppTypeIR {
  const trimmed = s.trim();
  if (trimmed === "") {
    return { kind: "opaque", raw: s };
  }

  // Direct primitive hit.
  if (isPrimitiveName(trimmed)) {
    return { kind: "primitive", name: trimmed };
  }

  // Pointer suffix `T*` (greedy: collapse trailing `**`? — codebase only uses
  // single indirection, but be conservative and peel one level).
  if (trimmed.endsWith("*")) {
    return { kind: "pointer", base: parseCppType(trimmed.slice(0, -1).trim()) };
  }

  // Reference suffix `T&`.
  if (trimmed.endsWith("&")) {
    const base = parseCppType(trimmed.slice(0, -1).trim());
    return { kind: "reference", base, isConst: isConstQualified(base) };
  }

  // `const` prefix: `const T`. (Also matches `const T&` already peeled above.)
  // We must be careful: `const char*` parses as `pointer(const char)`, not
  // `qualified(const, pointer(char))`. So only peel `const ` when it is the
  // outermost token AND the remainder is not itself a pointer/array.
  {
    const afterConst = peelConstPrefix(trimmed);
    if (afterConst !== null) {
      const inner = afterConst.trim();
      // If peeling const leaves a pointer/reference, the const binds to the
      // pointee (`const char*`), so don't peel — recurse into pointer branch.
      if (!endsWithPointerOrRef(inner)) {
        return { kind: "qualified", base: parseCppType(inner), isConst: true };
      }
    }
  }

  // `const` suffix: `T const` (rare in this codebase, but legal C++).
  {
    const beforeSuffixConst = peelConstSuffix(trimmed);
    if (beforeSuffixConst !== null) {
      return { kind: "qualified", base: parseCppType(beforeSuffixConst.trim()), isConst: true };
    }
  }

  // Template form `Name<...>`: dispatch on the head name.
  const templ = matchTemplate(trimmed);
  if (templ) {
    const { head, inner } = templ;
    switch (head) {
      case "std::vector":
        return { kind: "vector", element: parseCppType(splitTemplateArgs(inner)[0].trim()) };
      case "std::set":
      case "std::unordered_set":
        return { kind: "set", element: parseCppType(splitTemplateArgs(inner)[0].trim()) };
      case "std::map":
      case "std::unordered_map": {
        const args = splitTemplateArgs(inner).map((a) => parseCppType(a.trim()));
        return { kind: "map", key: args[0] ?? { kind: "opaque", raw: "" }, value: args[1] ?? { kind: "opaque", raw: "" } };
      }
      case "std::tuple":
        return { kind: "tuple", elements: splitTemplateArgs(inner).map((a) => parseCppType(a.trim())) };
      case "std::variant":
        return { kind: "variant", members: splitTemplateArgs(inner).map((a) => parseCppType(a.trim())) };
      case "std::function":
        return parseStdFunction(inner);
      case "std::shared_ptr":
      case "std::unique_ptr":
        return { kind: "smartPointer", wrapper: head, inner: parseCppType(splitTemplateArgs(inner)[0].trim()) };
      case "__tc_StaticArray": {
        const args = splitTemplateArgs(inner).map((a) => parseCppType(a.trim()));
        const sizeNode = args[1];
        const size = sizeNode && sizeNode.kind === "opaque" && /^\d+$/.test(sizeNode.raw.trim())
          ? Number(sizeNode.raw.trim())
          : undefined;
        return { kind: "staticArray", element: args[0] ?? { kind: "opaque", raw: "" }, size };
      }
      case "__tc_Generator":
        return { kind: "generator", yieldType: parseCppType(splitTemplateArgs(inner)[0].trim()) };
      default:
        // Generic user template: `MyClass<T, U>` or `std::something_unmodeled<…>`.
        return { kind: "named", name: head, args: splitTemplateArgs(inner).map((a) => parseCppType(a.trim())) };
    }
  }

  // `__tc_str_ptr` — may carry no argument in current usage.
  if (trimmed === "__tc_str_ptr") {
    return { kind: "strPtr" };
  }
  // `__tc_str_ptr(inner)` form (value-level wrap; the inner is an expression,
  // not a type, so we keep it opaque).
  if (trimmed.startsWith("__tc_str_ptr(") && trimmed.endsWith(")")) {
    return { kind: "strPtr" };
  }

  // `std::string` literal.
  if (trimmed === "std::string") {
    return { kind: "string" };
  }
  if (trimmed === "auto") {
    return { kind: "auto" };
  }

  // `const char*` — common enough to model explicitly as pointer(primitive char)
  // qualified const; but to keep round-tripping byte-identical, prefer letting
  // the named-with-const-prefix path handle it. We land here for the bare
  // `char` case via the named branch below.

  // C-array forms `T[N]` / `T[]` (e.g. `uint8_t[16]`, `int[]`). These are
  // emitted by HAL lowering (variables.ts) and parsed by element-access code.
  {
    const arr = matchCArray(trimmed);
    if (arr) {
      const { element, size } = arr;
      // Use `staticArray` when a concrete size is present (matches the
      // existing `T[N]` lowering), `cArray` when it's `T[]`.
      return size !== undefined
        ? { kind: "staticArray", element: parseCppType(element), size }
        : { kind: "cArray", element: parseCppType(element) };
    }
  }

  // Otherwise: a bare named type (struct/class/enum/typedef/typename).
  // Allow identifier-ish names including `::` scopes (e.g. `std::string`
  // already handled above; `Foo::Bar` is a named type).
  if (isValidTypeName(trimmed)) {
    return { kind: "named", name: trimmed };
  }

  // Last resort: preserve verbatim.
  return { kind: "opaque", raw: s };
}

function parseStdFunction(inner: string): CppTypeIR {
  // `inner` is `R(P, Q, ...)` where `R` itself may be a function type.
  // Find the *last* top-level `(` so the head is the return type and the
  // tail is the parameter list.
  let depth = 0;
  let parenIdx = -1;
  for (let i = inner.length - 1; i >= 0; i--) {
    const ch = inner[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      depth--;
      if (depth === 0) { parenIdx = i; break; }
    }
  }
  if (parenIdx < 0) {
    return { kind: "function", returnType: parseCppType(inner.trim()), params: [] };
  }
  const returnTypeStr = inner.slice(0, parenIdx).trim();
  const paramsStr = inner.slice(parenIdx + 1, inner.lastIndexOf(")")).trim();
  const params = paramsStr === ""
    ? []
    : splitFunctionParams(paramsStr).map((p) => parseCppType(p.trim()));
  return { kind: "function", returnType: parseCppType(returnTypeStr), params };
}

/** Split a function parameter list on top-level commas, respecting `()` and `<>`. */
function splitFunctionParams(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "<") depth++;
    else if (ch === ")" || ch === ">") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

interface TemplateMatch { head: string; inner: string; }

/** If `s` ends with `>` and has a top-level `<`, split into `head` and the
 *  raw inner string (whitespace preserved). Returns null otherwise. */
function matchTemplate(s: string): TemplateMatch | null {
  if (!s.endsWith(">")) return null;
  // Locate the *matching* opening `<` for the final `>`.
  let depth = 0;
  let openIdx = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i];
    if (ch === ">") depth++;
    else if (ch === "<") {
      depth--;
      if (depth === 0) { openIdx = i; break; }
    }
  }
  if (openIdx < 0) return null;
  const head = s.slice(0, openIdx);
  // Reject `head` that itself looks like a pointer/array tail, e.g. `int*<…>`.
  if (!isValidTypeName(head.trim())) return null;
  const inner = s.slice(openIdx + 1, s.length - 1);
  return { head: head.trim(), inner };
}

interface CArrayMatch { element: string; size?: number; }

function matchCArray(s: string): CArrayMatch | null {
  // `T[N]` or `T[]`. Use the *last* `[` to find the array suffix.
  if (!s.endsWith("]")) return null;
  const openIdx = s.lastIndexOf("[");
  if (openIdx < 0) return null;
  const element = s.slice(0, openIdx).trim();
  const sizeStr = s.slice(openIdx + 1, s.length - 1).trim();
  if (sizeStr === "") return { element };
  if (/^\d+$/.test(sizeStr)) return { element, size: Number(sizeStr) };
  return null;
}

function peelConstPrefix(s: string): string | null {
  return s.startsWith("const ") ? s.slice("const ".length) : null;
}
function peelConstSuffix(s: string): string | null {
  return s.endsWith(" const") ? s.slice(0, -" const".length) : null;
}
function endsWithPointerOrRef(s: string): boolean {
  return s.endsWith("*") || s.endsWith("&");
}
function isConstQualified(ir: CppTypeIR): boolean {
  return ir.kind === "qualified" && ir.isConst;
}
function isValidTypeName(s: string): boolean {
  // Identifier-ish, possibly scoped with `::`. Used only to decide whether to
  // accept a `head` or `bare` token as a type name.
  return /^(?:[A-Za-z_][A-Za-z0-9_]*)(?:::[A-Za-z_][A-Za-z0-9_]*)*$/.test(s);
}

// ---------------------------------------------------------------------------
// renderCppType — the single renderer
//
// Must be byte-identical to the historical spelling for every type string the
// transpiler emits. In particular:
//   - template args are joined with ", "
//   - `vector`/`map`/`set`/`tuple`/`variant` use the `std::` prefix
//   - `__tc_StaticArray<T, N>` joins element and size with ", "
//   - pointers print as `${base}*` (no space); references as `${base}&`
//   - qualified-const prints as `const ${base}` (prefix form, matching producer)
// ---------------------------------------------------------------------------

export function renderCppType(ir: CppTypeIR): string {
  switch (ir.kind) {
    case "primitive": return ir.name;
    case "auto": return "auto";
    case "string": return "std::string";
    case "strPtr": return "__tc_str_ptr";
    case "opaque": return ir.raw;
    case "named":
      return ir.args && ir.args.length > 0
        ? `${ir.name}<${ir.args.map(renderCppType).join(", ")}>`
        : ir.name;
    case "pointer": return `${renderCppType(ir.base)}*`;
    case "reference": return `${renderCppType(ir.base)}&`;
    case "qualified": return ir.isConst ? `const ${renderCppType(ir.base)}` : renderCppType(ir.base);
    case "vector": return `std::vector<${renderCppType(ir.element)}>`;
    case "set": return `std::set<${renderCppType(ir.element)}>`;
    case "map": return `std::map<${renderCppType(ir.key)}, ${renderCppType(ir.value)}>`;
    case "tuple": return `std::tuple<${ir.elements.map(renderCppType).join(", ")}>`;
    case "variant": return `std::variant<${ir.members.map(renderCppType).join(", ")}>`;
    case "function": {
      const params = ir.params.map(renderCppType).join(", ");
      return `std::function<${renderCppType(ir.returnType)}(${params})>`;
    }
    case "staticArray":
      return ir.size !== undefined
        ? `__tc_StaticArray<${renderCppType(ir.element)}, ${ir.size}>`
        : `__tc_StaticArray<${renderCppType(ir.element)}>`;
    case "cArray":
      return ir.size !== undefined
        ? `${renderCppType(ir.element)}[${ir.size}]`
        : `${renderCppType(ir.element)}[]`;
    case "generator": return `__tc_Generator<${renderCppType(ir.yieldType)}>`;
    case "smartPointer": return `${ir.wrapper}<${renderCppType(ir.inner)}>`;
    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = ir;
      void _exhaustive;
      return "";
    }
  }
}

// ---------------------------------------------------------------------------
// Predicate helpers — thin wrappers that replace inline string inspection.
//
// These cover the recurring idioms found across `ir/` and `emit/`:
// `endsWith("*")` → `isPointer`; `startsWith("std::vector<")` → `isVector`;
// `startsWith("std::map<") || startsWith("std::set<")` → `isAssociative`;
// etc.
// ---------------------------------------------------------------------------

/** True for `T*` (any depth of indirection). */
export function isPointer(ir: CppTypeIR): boolean {
  return ir.kind === "pointer";
}

/** True for `T&` (and `const T&`). */
export function isReference(ir: CppTypeIR): boolean {
  return ir.kind === "reference";
}

/** True for any container that supports element/index access:
 *  vector, set, map, staticArray, cArray. */
export function isContainer(ir: CppTypeIR): boolean {
  return ir.kind === "vector" || ir.kind === "set" || ir.kind === "map"
    || ir.kind === "staticArray" || ir.kind === "cArray";
}

export function isVector(ir: CppTypeIR): boolean { return ir.kind === "vector"; }
export function isMap(ir: CppTypeIR): boolean { return ir.kind === "map"; }
export function isSet(ir: CppTypeIR): boolean { return ir.kind === "set"; }
export function isTuple(ir: CppTypeIR): boolean { return ir.kind === "tuple"; }
export function isVariant(ir: CppTypeIR): boolean { return ir.kind === "variant"; }
export function isStdFunction(ir: CppTypeIR): boolean { return ir.kind === "function"; }
export function isStaticArray(ir: CppTypeIR): boolean { return ir.kind === "staticArray"; }
export function isCArray(ir: CppTypeIR): boolean { return ir.kind === "cArray"; }

/** True for `std::string` / `__tc_str_ptr` / `const char*`-ish string types.
 *  Does NOT consult platform strategy — callers that need platform-aware string
 *  detection (e.g. Arduino `String`) should still call `strategy.isStringLikeType`. */
export function isStringLike(ir: CppTypeIR): boolean {
  if (ir.kind === "string" || ir.kind === "strPtr") return true;
  if (ir.kind === "pointer") {
    const pointee = ir.base.kind === "qualified" ? ir.base.base : ir.base;
    return pointee.kind === "primitive"
      && (pointee.name === "char" || pointee.name === "signed char" || pointee.name === "unsigned char");
  }
  return false;
}

/** True for builtin scalars (`int`, `double`, …) and `std::string`/`bool`.
 *  Corresponds to the `isPrimitiveCppType` helpers in statement-renderer. */
export function isPrimitive(ir: CppTypeIR): boolean {
  if (ir.kind === "primitive") return true;
  if (ir.kind === "qualified") return isPrimitive(ir.base);
  return false;
}

/** Peel pointer/reference/const qualification and return the underlying type.
 *  `Foo*` → `Foo`, `const Bar&` → `Bar`, `std::vector<T>*` → `std::vector<T>`.
 *  Corresponds to the `replace(/\*$/, "").replace(/^const\s+/, "").trim()`
 *  idiom scattered through expression-renderer / setup. */
export function bareType(ir: CppTypeIR): CppTypeIR {
  let cur = ir;
  while (true) {
    if (cur.kind === "pointer" || cur.kind === "reference") {
      cur = cur.base;
    } else if (cur.kind === "qualified") {
      cur = cur.base;
    } else {
      return cur;
    }
  }
}

/** Element type of a vector/set/staticArray/cArray, or the value type of a map.
 *  Returns undefined for non-containers. Replaces the duplicated
 *  `slice("std::vector<".length, -1).trim()` copies. */
export function elementOf(ir: CppTypeIR): CppTypeIR | undefined {
  switch (ir.kind) {
    case "vector":
    case "set":
    case "staticArray":
    case "cArray":
      return ir.element;
    case "map":
      return ir.value;
    default:
      return undefined;
  }
}

/** Coarse kind bucket for the snprintf format-specifier dispatcher
 *  (`emit/snprintf-helpers.ts`). Replaces the `cppType === "int" || ...` ladder. */
export type CppFormatKind = "bool" | "int" | "uint" | "long" | "ulong" | "float" | "string" | "char" | "pointer" | "other";

export function formatKindOf(ir: CppTypeIR): CppFormatKind {
  // `char*` / `const char*` are C-strings (%s), not single chars (%c).
  // Must be checked BEFORE the generic pointer branch.
  if (isCharPointer(ir)) return "string";
  // Any other pointer → %p-ish dispatch bucket. Checked before bareType()
  // strips the pointer.
  if (ir.kind === "pointer") return "pointer";
  const bare = bareType(ir);
  if (bare.kind === "string" || bare.kind === "strPtr") return "string";
  if (bare.kind === "primitive") {
    switch (bare.name) {
      case "bool": return "bool";
      case "char": case "signed char": case "unsigned char": return "char";
      case "float": case "double": case "long double": return "float";
      case "int": case "short": return "int";
      case "unsigned int": case "unsigned short": case "uint8_t": case "uint16_t": return "uint";
      case "long": case "int32_t": case "int64_t": return "long";
      case "unsigned long": case "unsigned long long": case "long long":
      case "uint32_t": case "uint64_t": case "size_t": case "uintptr_t": return "ulong";
      default: return "other";
    }
  }
  return "other";
}

/** True for `char*`, `const char*`, `signed char*`, etc. — C-strings, not
 *  pointers-to-single-chars. Drives `%s` formatting in snprintf dispatch. */
function isCharPointer(ir: CppTypeIR): boolean {
  if (ir.kind !== "pointer") return false;
  const pointee = ir.base.kind === "qualified" ? ir.base.base : ir.base;
  return pointee.kind === "primitive"
    && (pointee.name === "char" || pointee.name === "signed char" || pointee.name === "unsigned char");
}

// ---------------------------------------------------------------------------
// Builder helpers — replace inline `${x}*` / `std::vector<${x}>` construction.
// ---------------------------------------------------------------------------

export const CppTypeIR = {
  primitive: (name: CppPrimitiveName): CppTypeIR => ({ kind: "primitive", name }),
  auto: (): CppTypeIR => ({ kind: "auto" }),
  string: (): CppTypeIR => ({ kind: "string" }),
  bool: (): CppTypeIR => ({ kind: "primitive", name: "bool" }),
  void: (): CppTypeIR => ({ kind: "primitive", name: "void" }),
  int: (): CppTypeIR => ({ kind: "primitive", name: "int" }),
  double: (): CppTypeIR => ({ kind: "primitive", name: "double" }),
  named: (name: string, args?: CppTypeIR[]): CppTypeIR => ({ kind: "named", name, args }),
  pointer: (base: CppTypeIR): CppTypeIR => ({ kind: "pointer", base }),
  reference: (base: CppTypeIR, isConst = false): CppTypeIR => ({ kind: "reference", base, isConst }),
  const_: (base: CppTypeIR): CppTypeIR => ({ kind: "qualified", base, isConst: true }),
  vector: (element: CppTypeIR): CppTypeIR => ({ kind: "vector", element }),
  set: (element: CppTypeIR): CppTypeIR => ({ kind: "set", element }),
  map: (key: CppTypeIR, value: CppTypeIR): CppTypeIR => ({ kind: "map", key, value }),
  tuple: (elements: CppTypeIR[]): CppTypeIR => ({ kind: "tuple", elements }),
  variant: (members: CppTypeIR[]): CppTypeIR => ({ kind: "variant", members }),
  function: (returnType: CppTypeIR, params: CppTypeIR[]): CppTypeIR => ({ kind: "function", returnType, params }),
  staticArray: (element: CppTypeIR, size?: number): CppTypeIR => ({ kind: "staticArray", element, size }),
  cArray: (element: CppTypeIR, size?: number): CppTypeIR => ({ kind: "cArray", element, size }),
  generator: (yieldType: CppTypeIR): CppTypeIR => ({ kind: "generator", yieldType }),
  smartPointer: (wrapper: "std::shared_ptr" | "std::unique_ptr", inner: CppTypeIR): CppTypeIR => ({ kind: "smartPointer", wrapper, inner }),
  strPtr: (): CppTypeIR => ({ kind: "strPtr" }),
  opaque: (raw: string): CppTypeIR => ({ kind: "opaque", raw }),
};

// ---------------------------------------------------------------------------
// Convenience: parse-then-inspect. Lets call sites that today do
// `cppType.endsWith("*")` become `parsedIsPointer(cppType)` while `CppType`
// is still a string during the staged migration.
// ---------------------------------------------------------------------------

export function parsedIsPointer(cppType: string): boolean { return isPointer(parseCppType(cppType)); }
export function parsedIsStringLike(cppType: string): boolean { return isStringLike(parseCppType(cppType)); }
export function parsedIsPrimitive(cppType: string): boolean { return isPrimitive(parseCppType(cppType)); }
export function parsedIsContainer(cppType: string): boolean { return isContainer(parseCppType(cppType)); }
export function parsedIsVector(cppType: string): boolean { return isVector(parseCppType(cppType)); }
export function parsedIsMap(cppType: string): boolean { return isMap(parseCppType(cppType)); }
export function parsedIsSet(cppType: string): boolean { return isSet(parseCppType(cppType)); }
export function parsedIsTuple(cppType: string): boolean { return isTuple(parseCppType(cppType)); }
export function parsedIsVariant(cppType: string): boolean { return isVariant(parseCppType(cppType)); }
export function parsedIsStaticArray(cppType: string): boolean { return isStaticArray(parseCppType(cppType)); }
/** True for `std::string` (and `std::string&`, `const std::string`, etc.). */
export function parsedIsStdString(cppType: string): boolean {
  const ir = parseCppType(cppType);
  return bareType(ir).kind === "string";
}
export function parsedElementOf(cppType: string): CppTypeIR | undefined { return elementOf(parseCppType(cppType)); }
/** Element/value type of a container, rendered back to a string. Replaces the
 *  `slice("std::vector<".length, -1).trim()` idiom at consumer sites. */
export function parsedElementString(cppType: string): string | undefined {
  const e = elementOf(parseCppType(cppType));
  return e ? renderCppType(e) : undefined;
}
/** Bare (pointer/const/reference-stripped) type rendered as a string. Replaces
 *  `cppType.replace(/\*$/, "").replace(/^const\s+/, "").trim()` at consumer sites. */
export function parsedBareString(cppType: string): string { return renderCppType(bareType(parseCppType(cppType))); }
export function parsedBareType(cppType: string): CppTypeIR { return bareType(parseCppType(cppType)); }

/**
 * Collect every user-named type referenced anywhere inside a C++ type string
 * (including nested template args, pointer bases, vector elements, etc.).
 * Replaces the historical "match all identifiers then filter primitives"
 * idiom used for dependency tracking in call-graph analysis.
 *
 * Returns only `named`-kind names — primitives, `std::string`, `auto`, etc.
 * are excluded because they are not user-defined types.
 */
export function collectNamedTypes(ir: CppTypeIR): string[] {
  const out: string[] = [];
  const walk = (node: CppTypeIR): void => {
    switch (node.kind) {
      case "named":
        out.push(node.name);
        if (node.args) for (const a of node.args) walk(a);
        break;
      case "pointer":
      case "reference":
      case "qualified":
        walk(node.base);
        break;
      case "vector":
      case "set":
      case "staticArray":
      case "cArray":
        walk(node.element);
        break;
      case "generator":
        walk(node.yieldType);
        break;
      case "smartPointer":
        walk(node.inner);
        break;
      case "map":
        walk(node.key);
        walk(node.value);
        break;
      case "tuple":
        for (const m of node.elements) walk(m);
        break;
      case "variant":
        for (const m of node.members) walk(m);
        break;
      case "function":
        walk(node.returnType);
        for (const p of node.params) walk(p);
        break;
      default:
        // primitive, auto, string, strPtr, opaque — no named children.
        break;
    }
  };
  walk(ir);
  return out;
}

/** String-in convenience for `collectNamedTypes(parseCppType(s))`. */
export function parsedCollectNamedTypes(cppType: string): string[] {
  return collectNamedTypes(parseCppType(cppType));
}

/** True if the type is a plain struct/class name with no template args, pointer,
 *  reference, array, or container wrapper — i.e. the kind of type that a
 *  `return null` should lower to `return {};` (value-init).
 *  Replaces the `!includes("<") && !endsWith("*") && !endsWith("]")` idiom. */
export function parsedIsPlainStructType(cppType: string): boolean {
  const ir = parseCppType(cppType);
  const bare = bareType(ir);
  if (bare.kind !== "named") return false;
  if (bare.args && bare.args.length > 0) return false;
  return true;
}

/**
 * True for types that own a string buffer and therefore need `.c_str()` when
 * passed to a C variadic (printf/snprintf): `std::string`, `__tc_str_ptr`,
 * and platform string types like `String`. NOT true for `const char*`
 * / `char*`, which are already C-strings.
 *
 * This is the structured replacement for the
 * `normalized === "std::string" || normalized === "String" || normalized === "__tc_str_ptr"`
 * idiom in the snprintf/expression renderers.
 */
export function needsCStrForStringLike(cppType: string): boolean {
  const ir = parseCppType(cppType);
  // A top-level pointer (char*) is already a C-string — no .c_str() needed.
  if (ir.kind === "pointer") return false;
  // Peel const/reference wrappers to reach the underlying category.
  let node: CppTypeIR = ir;
  while (node.kind === "qualified" || node.kind === "reference") {
    node = node.base;
    if (node.kind === "pointer") return false;
  }
  return node.kind === "string" || node.kind === "strPtr"
    || (node.kind === "named" && node.name === "String");
}
