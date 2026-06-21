import ts from "typescript";
import type { Diagnostic } from "../types.js";

// ---------------------------------------------------------------------------
// SemanticFacts — a node-keyed fact map consumed by semantic gates.
//
// Design ref: docs/design-semantic-facts.md
//
// The semantic gates in orchestrator/type-checker.ts previously re-derived
// semantic facts from TS syntax + TypeChecker at every use site, and stored
// "this binding is a map-value copy" facts as names in per-scope string Sets.
// This module replaces that with a precomputed fact map: each expression/statement
// node carries its own facts, computed once, read many times by gate rules.
//
// Phase 0 (this file): types + the CanonicalType resolver. The six boolean
// predicates in type-checker.ts (isMapLikeType, isSetLikeType, isTypedArrayType,
// isArrayLikeType, isStringLikeType, isPrimitiveLikeValueType) become thin
// wrappers around canonicalize(), so there is one place that turns a ts.Type
// into a category instead of six places each calling typeToString() in disguise.
//
// Phase 1 (later): the ordered analysis passes that populate the FactStore.
// ---------------------------------------------------------------------------

/**
 * Canonical type category. Deliberately small — this is NOT a full SType
 * algebra. It exists to stop the six boolean predicates from each calling
 * typeToString() in disguise.
 *
 * Field names are chosen to be SIR-compatible: a future promotion to a full
 * SType algebra should be able to widen `category` without renaming consumers.
 */
export type CanonicalType =
  | "primitive"   // number, string, boolean, bigint, etc.
  | "struct"      // classes and interfaces (lower to C++ value/struct types)
  | "array"       // Array<T>, T[], tuple -> std::vector / static array
  | "typed-array" // Int8Array .. Float64Array -> pointer-like storage
  | "map"         // Map, ReadonlyMap, Record -> std::map
  | "set"         // Set, ReadonlySet -> std::set
  | "function"
  | "any"         // `any` — the transpiler handles it via inference; NOT a hazard
  | "unknown";    // genuinely unclassifiable -> the verifier flags this

/**
 * How an expression's value reaches its use. The categories the current gates
 * care about are: copy (map/record value lookup, by-value param) and reference.
 * temporary/rvalue are reserved for future promotion; not all are populated in
 * Phase 1.
 */
export type ValueCategory =
  | "lvalue"    // addressable, assignable
  | "rvalue"    // pure value
  | "copy"      // value copy from a container lookup or by-value param
  | "reference" // refers to storage owned elsewhere (e.g. by-ref param)
  | "temporary"; // result of an expression with no stable storage

export type Lifetime =
  | "local"        // function-local variable
  | "param"        // by-value function parameter
  | "param-by-ref" // by-reference parameter
  | "field"        // class/struct field
  | "global"       // module-level
  | "temporary"
  | "unknown";

/**
 * Nullability as the lowering sees it. `erased` = TS optional (`x?: T`) or
 * nullable union flattened to a value type in C++ (the case
 * TS2CPP_OPTIONAL_FIELD_NULLISH catches). `none` = definitively not null.
 */
export type Nullable = "none" | "erased" | "unknown";

/**
 * Provenance of a value, used by the mutation gates to decide whether a write
 * reaches the caller/container.
 *
 * Only the origins the current gates consume are defined here. Add new origins
 * as new gates migrate — do not pre-declare a large set.
 */
export type SemanticOrigin =
  | "map-value-lookup"   // map.get(k)!, map.at(k), map[k] on a Map/Record
  | "array-param"        // by-value array parameter (std::vector copy)
  | "typed-array-param"  // pointer-like typed-array parameter
  | "local-binding"
  | "field-access"
  | "other";

export interface SemanticFacts {
  /** Canonical type category. The verifier requires this to be non-"unknown"
   *  for every expression in user code, else a fatal diagnostic is emitted. */
  type: CanonicalType;
  valueCategory?: ValueCategory;
  lifetime?: Lifetime;
  nullable?: Nullable;
  origin?: SemanticOrigin;
  /**
   * The concrete C++ type this node lowers to, when it is determinable from
   * the TS type alone (e.g. `number` → "double", `string` → "std::string",
   * `Uint8Array` → "uint8_t*"). Undefined when the cppType depends on IR-build
   * context the type-checker does not have (user class field resolution,
   * cross-module types, `auto` deduction from a complex initializer).
   *
   * Phase 3 of the type-resolution consolidation. This is populated from the
   * ts.TypeChecker (which buildSemanticFacts already holds) as
   * forward-compatible infrastructure: it lets gate rules read a concrete
   * cppType without re-deriving it, and — if the pipeline is later reordered
   * to build ProgramIR before the gates — the SymbolTable can populate this
   * field directly and the ts.TypeChecker derivation removed. The direction is
   * strictly one-way: gates read facts.cppType, they never feed it back into
   * the IR/emit SymbolTable. See docs/design-semantic-facts.md.
   */
  cppType?: string;
}

/**
 * Read-only view exposed to gate rules.
 *
 * `get` returns undefined for nodes outside user files or nodes the pipeline
 * did not visit. Gate rules treat undefined as "no fact, skip" — they never
 * throw. The verifier (Phase 3) is the only place that asserts presence.
 */
export interface FactStore {
  /** Facts for a node, or undefined if not in a user file / not visited. */
  get(node: ts.Node): Readonly<SemanticFacts> | undefined;
  /** True iff node is in a user file and was visited by the pipeline. */
  has(node: ts.Node): boolean;
  /** Set a fact. Only called by analysis passes, before gate rules run. */
  set(node: ts.Node, facts: SemanticFacts): void;
  /**
   * Merge a partial fact into an existing entry, creating one if absent.
   * Used when multiple passes contribute to the same node. The `type` field
   * defaults to "unknown" if a new entry is created — callers that know the
   * type should set it explicitly first.
   */
  merge(node: ts.Node, partial: Partial<SemanticFacts>): void;
}

/**
 * Result of building semantic facts for a program.
 */
export interface AnalysisResult {
  facts: FactStore;
  /** Fatal analysis diagnostics — appended before gate diagnostics. */
  diagnostics: Diagnostic[];
  /** Identifier-to-origin resolver consumed by mutation gates. */
  resolver: BindingResolver;
}

// ---------------------------------------------------------------------------
// FactStore implementation
// ---------------------------------------------------------------------------

function createFactStore(): FactStore {
  const map = new WeakMap<ts.Node, SemanticFacts>();
  return {
    get(node) {
      return map.get(node);
    },
    has(node) {
      return map.has(node);
    },
    set(node, facts) {
      map.set(node, facts);
    },
    merge(node, partial) {
      const existing = map.get(node);
      if (existing) {
        map.set(node, { ...existing, ...partial });
      } else {
        map.set(node, { type: "unknown", ...partial });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// CanonicalType resolver
//
// One function replaces six boolean predicates. Each predicate in
// type-checker.ts becomes a one-line comparison against canonicalize().
// ---------------------------------------------------------------------------

/** Names recognized as typed arrays (Int8Array .. Float64Array, etc.). */
export const TYPED_ARRAY_NAMES = new Set([
  "Uint8Array",
  "Int8Array",
  "Uint16Array",
  "Int16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "BigUint64Array",
  "BigInt64Array",
]);

/** Names recognized as map-like containers. */
const MAP_NAMES = new Set(["Map", "ReadonlyMap", "Record"]);
/** Names recognized as set-like containers. */
const SET_NAMES = new Set(["Set", "ReadonlySet"]);

function typeToString(checker: ts.TypeChecker, type: ts.Type): string {
  return checker.typeToString(type);
}

/**
 * Resolve whether a type's symbol/alias name (or stringified form) contains
 * any of the given names. Walks union constituents. Mirrors the existing
 * typeHasName() logic so behavior is preserved exactly during migration.
 */
function typeHasName(
  checker: ts.TypeChecker,
  type: ts.Type,
  names: Set<string>,
): boolean {
  if (type.isUnion()) {
    return type.types.some((t) => typeHasName(checker, t, names));
  }
  const symbolName = type.getSymbol()?.getName();
  const aliasName = type.aliasSymbol?.getName();
  if (
    (symbolName && names.has(symbolName)) ||
    (aliasName && names.has(aliasName))
  ) {
    return true;
  }
  const text = typeToString(checker, type);
  for (const name of names) {
    if (new RegExp(`\\b${name}\\b`).test(text)) return true;
  }
  return false;
}

/**
 * True iff `type` is an array type (Array<T>, T[], tuple, ReadonlyArray).
 * Preserves the exact behavior of the existing isArrayLikeType() predicate.
 */
function isArrayLike(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some((t) => isArrayLike(checker, t));
  const checkerWithArray = checker as ts.TypeChecker & {
    isArrayType?: (candidate: ts.Type) => boolean;
  };
  if (checkerWithArray.isArrayType?.(type)) return true;
  if (checker.isTupleType(type)) return true;
  const text = typeToString(checker, type);
  return /\bReadonlyArray\b|\bArray\b/.test(text) || /\[\]$/.test(text);
}

/**
 * Classify a resolved TS type into a canonical category. This is the single
 * source of truth for "what kind of C++ concept does this type lower to?"
 *
 * Categories and their verifier meaning:
 *  - concrete categories (primitive, struct, array, ...) — fine.
 *  - "any" — the transpiler handles `any` via inference; the verifier treats
 *    this as a NON-hazard (it is not `unknown`).
 *  - "unknown" — genuinely unclassifiable; the verifier flags this.
 *
 * Unions with a null/undefined constituent (e.g. `Account | null`) are
 * classified by their non-null constituent, because the transpiler erases
 * optionality to the value type. `this` types resolve to the enclosing
 * class/interface, so they classify as struct.
 */
export function canonicalize(
  checker: ts.TypeChecker,
  type: ts.Type,
): CanonicalType {
  const flags = type.flags;

  // Nullable unions (T | null, T | undefined, T | null | undefined): classify
  // by the non-null constituent(s). The transpiler erases optionality. The
  // Null/Undefined flag bits live on the constituents, not the union itself,
  // so we scan the constituents.
  if (type.isUnion()) {
    const hasNullish = type.types.some(
      (t) => (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0,
    );
    if (hasNullish) {
      const nonNull = type.types.filter(
        (t) => (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0,
      );
      if (nonNull.length === 1) {
        return canonicalize(checker, nonNull[0]);
      }
      if (nonNull.length > 1) {
        // Multiple non-null constituents (a real discriminated union) — leave
        // as unknown; the transpiler lowers these to std::variant with caveats.
        return "unknown";
      }
      // Only null/undefined — treat as primitive so the verifier doesn't fire.
      return "primitive";
    }

    // Non-nullish union. Two common, lowering-safe shapes appear here as a
    // result of TypeScript control-flow narrowing and both lower to a single
    // primitive C++ type, so they should NOT trip the UNCLASSIFIABLE warning:
    //
    //   (1) A narrowed enum — `t.kind` after `if (t.kind === K.A) { continue; }`
    //       narrows to `K.B | K.C`. Each constituent is an EnumLiteral of the
    //       SAME enum, and the transpiler already lowers any enum member to a
    //       single integral type (compared via static_cast<int>).
    //   (2) A string-literal union — `op` narrowed to `"+" | "-" | "*" | "/"`,
    //       which lowers to a single std::string compared with ==.
    //
    // Coalesce when every non-null constituent canonicalizes to the SAME
    // category — then the union lowers to that one category. Heterogeneous
    // unions (e.g. number | string, or a real object discriminated union)
    // fall through to the per-constituent check below and remain "unknown"
    // (the std::variant case). Demo #22 Finding C.
    if (type.types.length > 1) {
      const categories = new Set<CanonicalType>();
      for (const t of type.types) {
        categories.add(canonicalize(checker, t));
      }
      if (categories.size === 1) {
        const only = categories.values().next().value as CanonicalType;
        if (only === "primitive") {
          return "primitive";
        }
      }
    }
  }

  // `any` — distinct from `unknown`. The transpiler legitimately handles any.
  if (flags & ts.TypeFlags.Any) {
    return "any";
  }
  // `unknown`/`never` — genuinely unclassifiable.
  if (flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Never)) {
    return "unknown";
  }

  // Intersection types (A & B) — common in generated d.ts files (e.g. mixin
  // patterns like `{ kind: "button" } & PressBinding`). They lower to a single
  // struct (the merged field set), so classify as struct. Check each
  // constituent; if any is a container/callable we defer to that, but the
  // overwhelmingly common case is all-object intersections → struct.
  if (flags & ts.TypeFlags.Intersection) {
    const parts = (type as ts.IntersectionType).types ?? [];
    const partCats = parts.map((t) => canonicalize(checker, t));
    // If every constituent is struct/primitive, the intersection is a struct.
    if (partCats.every((c) => c === "struct" || c === "primitive")) {
      return "struct";
    }
    // If all constituents agree on one non-struct category, inherit it.
    const unique = new Set(partCats);
    if (unique.size === 1) return partCats[0];
    return "struct";
  }

  // Primitives.
  if (
    flags &
    (ts.TypeFlags.NumberLike |
      ts.TypeFlags.StringLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.Enum |
      ts.TypeFlags.EnumLiteral |
      ts.TypeFlags.Null |
      ts.TypeFlags.Undefined |
      ts.TypeFlags.Void |
      ts.TypeFlags.Literal)
  ) {
    return "primitive";
  }

  // `this` types and type parameters (<T>) both carry the TypeParameter flag
  // (a `this` type is represented as a constrained type parameter whose
  // constraint is the enclosing class). Resolve to the constraint if bounded;
  // otherwise default to struct, which is the common case for class generics
  // and `this`.
  if (flags & ts.TypeFlags.TypeParameter) {
    const constraint = (type as ts.TypeParameter).getConstraint?.();
    if (constraint) {
      return canonicalize(checker, constraint);
    }
    return "struct";
  }

  // Containers, checked in specificity order.
  if (typeHasName(checker, type, MAP_NAMES) || /\bstd::map\b/.test(typeToString(checker, type))) {
    return "map";
  }
  if (typeHasName(checker, type, SET_NAMES)) {
    return "set";
  }
  if (typeHasName(checker, type, TYPED_ARRAY_NAMES)) {
    return "typed-array";
  }
  if (isArrayLike(checker, type)) {
    return "array";
  }

  // Functions.
  const symbol = type.getSymbol();
  if (symbol && (symbol.flags & ts.SymbolFlags.Function) !== 0) {
    return "function";
  }
  if (flags & ts.TypeFlags.Object) {
    const sig = type.getCallSignatures();
    if (sig.length > 0 && type.getProperties().length === 0) {
      // Pure callable object type with no other properties.
      return "function";
    }
  }

  // Everything object-like that isn't a known container or callable is a
  // struct (classes, interfaces, object literals, enums-by-shape).
  if (flags & ts.TypeFlags.Object) {
    return "struct";
  }

  return "unknown";
}

/**
 * Map a canonicalized type to the concrete C++ type the lowering emits, for
 * the categories where the cppType is deterministic from the TS type alone.
 * Returns undefined when the cppType depends on IR-build context the
 * type-checker does not have (user-defined class/interface names resolve to
 * themselves as struct names but their field layout is a SymbolTable concern;
 * `auto` deduction from complex initializers is an IR-build concern).
 *
 * This populates SemanticFacts.cppType so gate rules can read a concrete type
 * without re-deriving it. Phase 3 of the type-resolution consolidation — see
 * the doc comment on SemanticFacts.cppType for the one-way direction.
 */
export function cppTypeFromCanonicalType(
  checker: ts.TypeChecker,
  type: ts.Type,
  category: CanonicalType,
): string | undefined {
  switch (category) {
    case "primitive": {
      // number → double (the lowering's default number type), string →
      // std::string, boolean → bool. BigInt and enums share the primitive
      // category but have no single deterministic cppType here (enums lower to
      // their underlying integral width, which depends on member values known
      // only at IR-build time), so they stay undefined.
      const flags = type.flags;
      if (flags & ts.TypeFlags.StringLike) return "std::string";
      if (flags & ts.TypeFlags.NumberLike) return "double";
      if (flags & ts.TypeFlags.BooleanLike) return "bool";
      return undefined;
    }
    case "typed-array": {
      // Map the typed-array name to its element pointer type. The lowering
      // emits these exact pointer types (TYPED_ARRAY_ELEMENT_MAP in
      // build-ir-state); mirroring them here gives gates the concrete storage
      // type without touching the SymbolTable.
      const name = type.getSymbol()?.getName()
        ?? type.aliasSymbol?.getName()
        ?? "";
      switch (name) {
        case "Uint8Array": return "uint8_t*";
        case "Int8Array": return "int8_t*";
        case "Uint16Array": return "uint16_t*";
        case "Int16Array": return "int16_t*";
        case "Uint32Array": return "uint32_t*";
        case "Int32Array": return "int32_t*";
        case "Float32Array": return "float*";
        case "Float64Array": return "double*";
        default: return undefined;
      }
    }
    case "array":
      // std::vector<element>, but the element type depends on the TS element
      // type's own cppType (recursively). Defer to the SymbolTable for the
      // concrete element rather than recursing here; gates that need the
      // container-ness already have the "array" category.
      return undefined;
    case "map":
    case "set":
      // std::map<K,V> / std::set<T>, but the key/value element types are a
      // SymbolTable concern. Same rationale as "array".
      return undefined;
    case "struct": {
      // A user-defined class/interface lowers to its own name (classes as
      // pointers, interfaces as values). The bare name is the cppType prefix;
      // pointer-ness is resolved by the IR build. Return the bare name so a
      // gate can at least see "this is a Foo". Stringification matches the
      // lowering's class/interface naming.
      const name = type.getSymbol()?.getName() ?? type.aliasSymbol?.getName();
      return name;
    }
    case "function":
    case "any":
    case "unknown":
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// buildSemanticFacts — runs the ordered analysis passes.
//
// Passes (each produces a slice of the facts; none overwrites another's field):
//   1. Binding origin pass  — tags binding-identifier declaration nodes with
//      their origin (map-value-lookup, array-param, typed-array-param, ...).
//      Covers every binding form, not just identifier VariableDeclarations:
//      destructuring, for-of/in, and catch bindings are included. Reassignment
//      updates the origin to reflect the new initializer.
//   2. Container-lookup pass — tags container-lookup expression nodes
//      (map.get(k)!, map.at(k), map[k]) with origin "map-value-lookup".
//      The binding-origin pass uses this when classifying initializers.
//
// `userFiles` follows the same normalization as runSemanticGates: absolute
// paths, forward slashes, node_modules/packages excluded.
// ---------------------------------------------------------------------------

/**
 * Strip wrapper expressions (parens, non-null, as, type-assertion, satisfies)
 * to reach the underlying expression. Mirrors unwrapExpression() in
 * type-checker.ts so the two layers classify the same nodes.
 */
function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (true) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    if ((ts as any).isSatisfiesExpression?.(current)) {
      current = (current as ts.Expression & { expression: ts.Expression }).expression;
      continue;
    }
    return current;
  }
}

/** Is `node` a container value lookup (map.get/at, or map[k] on a Map/Record)? */
function isMapValueLookupExpression(
  node: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  const expr = unwrapExpression(node);
  if (ts.isCallExpression(expr)) {
    const callee = unwrapExpression(expr.expression);
    if (
      ts.isPropertyAccessExpression(callee) &&
      (callee.name.text === "get" || callee.name.text === "at")
    ) {
      return canonicalize(checker, checker.getTypeAtLocation(callee.expression)) === "map";
    }
  }
  if (ts.isElementAccessExpression(expr)) {
    return canonicalize(checker, checker.getTypeAtLocation(expr.expression)) === "map";
  }
  return false;
}

/** True iff the resolved type is an object-like value type (the map-value-copy case). */
function isObjectLikeValueType(type: ts.Type): boolean {
  if (type.isUnion()) {
    return type.types.some((t) => !typeIncludesNullish(t) && isObjectLikeValueType(t));
  }
  // Primitive flag set => not object-like. Mirrors isObjectLikeValueType() in
  // type-checker.ts (NumberLike | StringLike | BooleanLike | BigIntLike |
  // EnumLike | Null | Undefined | Void | Never | Any | Unknown).
  const flags = type.flags;
  const primitiveFlags =
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.StringLike |
    ts.TypeFlags.BooleanLike |
    ts.TypeFlags.BigIntLike |
    ts.TypeFlags.EnumLike |
    ts.TypeFlags.Null |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Void |
    ts.TypeFlags.Never |
    ts.TypeFlags.Any |
    ts.TypeFlags.Unknown;
  return (flags & primitiveFlags) === 0;
}

/**
 * True iff `type` is the instance type of a `class` declaration (or a union
 * whose non-nullish constituent is). A TypeScript class is a *reference* type,
 * and the transpiler lowers it to a C++ pointer (`C*`, see
 * `ir/type-resolution.ts` `classTypeNames`). That distinction matters for the
 * `TS2CPP_MAP_VALUE_COPY_MUTATION` gate: a `map.get(k)` whose value type is a
 * class returns a *pointer*, so a field write `node.value = v` lowers to
 * `node->value = v` and **persists** through the pointer — it is NOT a value
 * copy the way an `interface`/struct-typed fetch is. Only struct-valued
 * (interface / object-literal) map entries are value copies; class entries are
 * exempt. (Demo #25 Finding A.)
 */
function isClassInstanceType(type: ts.Type): boolean {
  if (type.isUnion()) {
    return type.types.some((t) => !typeIncludesNullish(t) && isClassInstanceType(t));
  }
  // A class instance type's symbol carries SymbolFlags.Class. Resolve through
  // aliases (e.g. `type Alias = SomeClass`) so an aliased class is still seen
  // as a class.
  let symbol = type.getSymbol();
  if (symbol && symbol.flags & ts.SymbolFlags.TypeAlias) {
    // For an alias, the aliased type is reachable via the checker; fall back to
    // a flag check on the alias target by walking type.aliasSymbol.
    symbol = type.aliasSymbol ?? symbol;
  }
  if (!symbol) return false;
  return (symbol.flags & ts.SymbolFlags.Class) !== 0;
}

function typeIncludesNullish(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(typeIncludesNullish);
  return (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0;
}

/**
 * A name->facts binding resolver. Gate rules call `resolveOrigin(identifier)`
 * to ask "what is the origin of the value this identifier refers to?", which
 * resolves the identifier to its declaration and looks up the declaration's
 * origin fact. This replaces the name-based scope-chain lookup in the old
 * GateScope machinery: it is shadowing-proof because the checker resolves the
 * identifier to the exact declaration, regardless of scope.
 */
export interface BindingResolver {
  /**
   * Resolve an identifier's value origin. Returns undefined if the identifier
   * is not a value reference or has no recorded origin.
   */
  resolveOrigin(identifier: ts.Identifier): SemanticOrigin | undefined;
}

function isUserFile(filePath: string, userFileSet: Set<string>): boolean {
  const p = filePath.replace(/\\/g, "/");
  if (!userFileSet.has(p)) return false;
  if (p.includes("/node_modules/") || p.includes("/packages/")) return false;
  return true;
}

/**
 * Build the SemanticFacts store for a program by running the analysis passes.
 */
export function buildSemanticFacts(
  program: ts.Program,
  userFiles: string[],
): AnalysisResult {
  const facts = createFactStore();
  const diagnostics: Diagnostic[] = [];
  const checker = program.getTypeChecker();
  const userFileSet = new Set(userFiles.map((f) => f.replace(/\\/g, "/")));

  // Map from binding-declaration identifier node -> origin. Populated by the
  // binding-origin pass, read by BindingResolver.resolveOrigin. Uses a Map
  // (not the WeakMap inside FactStore) so resolveOrigin can look up origins
  // directly by declaration node without going through the read-only store.
  const originByDeclaration = new Map<ts.Node, SemanticOrigin>();

  // Walk user files and tag binding declarations with their origin.
  for (const sourceFile of program.getSourceFiles()) {
    if (!isUserFile(sourceFile.fileName, userFileSet)) continue;
    visitForBindings(sourceFile);
  }

  function recordOrigin(declaration: ts.Node, origin: SemanticOrigin): void {
    originByDeclaration.set(declaration, origin);
    // Also set a fact on the declaration node itself, for any consumer that
    // walks declarations directly.
    facts.merge(declaration, { origin });
  }

  /**
   * Record an origin on the declaration node that a use-site identifier's
   * symbol will resolve to. The checker reports a symbol's valueDeclaration
   * as the declarator node (VariableDeclaration for `const x = …`,
   * BindingElement for `const { x } = …`, Parameter for function params), not
   * the identifier inside it — so we record on the declarator, not the name.
   */
  function recordBindingName(
    bindingName: ts.BindingName,
    origin: SemanticOrigin,
  ): void {
    if (ts.isIdentifier(bindingName)) {
      // For a simple `const x = …`, the declarator is the parent
      // VariableDeclaration / Parameter / etc. (never the identifier itself).
      const declarator = bindingName.parent;
      if (declarator) recordOrigin(declarator, origin);
      return;
    }
    // Object/array binding patterns: each BindingElement is its own symbol
    // declaration, so record on each element.
    const walk = (pattern: ts.Node): void => {
      pattern.forEachChild((child) => {
        if (ts.isBindingElement(child)) {
          // The BindingElement is the symbol's valueDeclaration.
          recordOrigin(child, origin);
          if (!ts.isIdentifier(child.name)) walk(child.name);
        } else if (ts.isObjectBindingPattern(child) || ts.isArrayBindingPattern(child)) {
          walk(child);
        }
      });
    };
    walk(bindingName);
  }

  function visitForBindings(node: ts.Node): void {
    // Function parameters: array / typed-array params get their origin.
    if (isFunctionLikeWithBodyNode(node)) {
      for (const param of node.parameters) {
        const paramType = checker.getTypeAtLocation(param);
        const cat = canonicalize(checker, paramType);
        if (cat === "array") {
          recordBindingName(param.name, "array-param");
        } else if (cat === "typed-array") {
          recordBindingName(param.name, "typed-array-param");
        }
      }
    }

    // Variable declarations: classify initializer.
    if (ts.isVariableDeclaration(node) && node.initializer) {
      recordDeclarationOrigin(node.name, node.initializer);
    }
    // Reassignment (task = other) updates the existing declaration's origin
    // to reflect the new value. The symbol resolves back to the original
    // declarator, so we update that node's entry rather than tagging a new one.
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperatorKind(node.operatorToken.kind) &&
      ts.isIdentifier(node.left)
    ) {
      recordReassignmentOrigin(node.left, node.right);
    }

    // for-of / for-in bindings.
    if (
      (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
      ts.isVariableDeclarationList(node.initializer)
    ) {
      for (const decl of node.initializer.declarations) {
        if (decl.initializer) {
          recordDeclarationOrigin(decl.name, decl.initializer);
        } else {
          recordBindingName(decl.name, "local-binding");
        }
      }
    }

    // catch bindings.
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      recordBindingName(node.variableDeclaration.name, "local-binding");
    }

    ts.forEachChild(node, visitForBindings);
  }

  /**
   * Classify a declaration initializer and tag the declarator's origin. Only
   * called for new bindings (VariableDeclaration, for-of/in). Non-special
   * bindings get no entry, so resolveOrigin returns undefined for them.
   */
  function recordDeclarationOrigin(
    name: ts.BindingName,
    initializer: ts.Expression,
  ): void {
    const init = unwrapExpression(initializer);
    if (isMapValueLookupExpression(init, checker)) {
      // Only struct-typed values count as "map-value copies" — primitive
      // values fetched from a map are not mutated-through, matching the old
      // isObjectLikeValueType gate. A *class*-typed value is also exempt: a TS
      // class is a reference type that lowers to a C++ pointer, so
      // `map.get(k)` returns a pointer and a field write through it persists
      // (it is not a value copy). Only interface / object-literal entries are
      // value copies. (Demo #25 Finding A.)
      const bindingType = checker.getTypeAtLocation(name);
      if (isObjectLikeValueType(bindingType) && !isClassInstanceType(bindingType)) {
        recordBindingName(name, "map-value-lookup");
        return;
      }
    }
    // Otherwise it's a plain local binding — no entry. resolveOrigin returns
    // undefined (meaning "no special origin"), which is correct for the gates.
  }

  /**
   * A reassignment `task = expr` updates the existing declaration's origin to
   * reflect the new value. Resolve the LHS identifier's symbol to its original
   * declarator and overwrite its entry. If the new value isn't a map-value
   * lookup, the origin is cleared (the binding is no longer a copy).
   */
  function recordReassignmentOrigin(
    left: ts.Identifier,
    right: ts.Expression,
  ): void {
    const symbol = checker.getSymbolAtLocation(left);
    if (!symbol) return;
    const declarator = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declarator) return;
    const init = unwrapExpression(right);
    if (isMapValueLookupExpression(init, checker)) {
      const valueType = checker.getTypeAtLocation(left);
      if (isObjectLikeValueType(valueType) && !isClassInstanceType(valueType)) {
        recordOrigin(declarator, "map-value-lookup");
        return;
      }
    }
    // The new value isn't a map-value copy — clear any prior copy origin so a
    // later mutation isn't misattributed. (Keep param origins intact: an array
    // parameter stays an array parameter regardless of reassignment inside the
    // function body, because reassigning a parameter doesn't change its C++
    // by-value passing.)
    const prior = originByDeclaration.get(declarator);
    if (prior === "map-value-lookup") {
      originByDeclaration.delete(declarator);
    }
  }

  // Build the BindingResolver that gate rules will use.
  const resolver: BindingResolver = {
    resolveOrigin(identifier) {
      const symbol = checker.getSymbolAtLocation(identifier);
      if (!symbol) return undefined;
      // Resolve aliases (imports) to the underlying value declaration.
      let valueSymbol = symbol;
      if (symbol.flags & ts.SymbolFlags.Alias) {
        try {
          valueSymbol = checker.getAliasedSymbol(symbol);
        } catch {
          /* keep original */
        }
      }
      const declarations = valueSymbol.valueDeclaration
        ? [valueSymbol.valueDeclaration, ...(valueSymbol.declarations ?? [])]
        : valueSymbol.declarations ?? [];
      for (const decl of declarations) {
        // The declaration node itself is the key we recorded (the identifier
        // for simple bindings, or the BindingElement/identifier for patterns).
        if (originByDeclaration.has(decl)) {
          return originByDeclaration.get(decl);
        }
      }
      return undefined;
    },
  };

  // Attach the resolver to the result via a closure, exposed through a
  // separate field so gate rules in type-checker.ts can resolve identifiers.
  return {
    facts,
    diagnostics,
    resolver,
  };
}

// --- helpers duplicated from type-checker.ts to keep this module standalone ---

type FunctionLikeNode =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction;

function isFunctionLikeWithBodyNode(node: ts.Node): node is FunctionLikeNode & { body: ts.Block | ts.Expression } {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)) &&
    !!node.body
  );
}

function isAssignmentOperatorKind(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken ||
    kind === ts.SyntaxKind.AmpersandEqualsToken ||
    kind === ts.SyntaxKind.BarEqualsToken ||
    kind === ts.SyntaxKind.CaretEqualsToken ||
    kind === ts.SyntaxKind.LessThanLessThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
    kind === ts.SyntaxKind.BarBarEqualsToken
  );
}
