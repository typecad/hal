# SemanticFacts Layer — Design Plan

Status: **Proposed** (awaiting review)
Scope: Refactor of semantic-gate detection only. No emitter changes. No IR rewrite.
Target: `packages/cuttlefish/src/orchestrator/type-checker.ts` and one new module.

---

## 1. Problem statement

`runSemanticGates` (`orchestrator/type-checker.ts:547`) is the single place that
prevents C++ compiler-error leakage. It re-derives semantic facts from TS syntax
+ TypeChecker at every use site. Two structural problems follow from that:

1. **Per-name scoping via string `Set`s.** Facts like "this binding is a
   map-value copy" are stored as names in `GateScope` sets
   (`mapValueCopyBindings`, `arrayParams`, `typedArrayParams`; lines 223–225).
   `lookupScopedSet` (lines 243–251) resolves by name through a scope chain and
   stops at the first `declaredNames` hit. Only two binding forms register
   (`declareBinding`, lines 253–258): function parameters and identifier-named
   `VariableDeclaration`. This leaves silent gaps:
   - Destructuring bindings (`const { x } = …`) never reset, so a stale
     outer "map-value-copy" fact can leak onto an inner binding of the same name.
   - `for (const k of …)` / `for (const k in …)` and `catch (e)` bindings are
     not registered either.
   - Reassignment (`let t = map.get(k)!; t = other; t.done = true;`) keeps the
     original origin; the gate reads the stale copy fact.

2. **Mutation rules duplicated per syntax form.** Every mutation rule is
   written twice — once for `=` (lines 793–811) and once for `++`/`--`
   (lines 813–835). Adding a third form (`??=`, `op=`) means a third copy that
   will drift. The detection-emitter drift class (the gate's heuristic about
   what lowers to `std::map::at` diverging from the actual lowering) is also
   possible because the gate guesses lowering intent from syntax.

This plan adds a **node-keyed fact map** so each expression carries its own
facts, computed once. Detection rules become predicates over facts rather than
re-derivation from syntax.

---

## 2. Non-goals

Explicitly out of scope. Each is deferred until a concrete consumer appears.

- **No `SProgram` / `SFunction` / `SExpr` node algebra.** That is the full
  Typed Semantic IR proposal and is a separate decision. Field names in this
  design are chosen to be SIR-compatible so a future promotion is a rename, not
  a redesign — but the representation stays a node annotation, not a parallel IR.
- **No emitter changes.** The fact map is consumed only by
  `runSemanticGates`, which runs on original TS source before any hoisting
  in `build-ir.ts`. The `WeakMap<ts.Node, …>` is therefore safe — TS nodes are
  alive for the entire gate pass. (See §8 for the promotion criterion.)
- **No new supported TS subset.** What is rejected today stays rejected; only
  the detection mechanism changes.
- **No interprocedural ownership / alias analysis.** Aliasing through calls
  (`mutate({ f: t.field })`) stays undetected — that requires the full SIR
  ownership pass this plan defers.

---

## 3. What it intercepts

**Newly intercepted (false negatives today):**

| Case | Today | After |
|---|---|---|
| Shadowing across block scopes when inner binding is unregistered (destructuring, `for…of`, `catch`) | Stale outer fact leaks | Facts are per-node; no name aliasing |
| Reassignment changing origin | Stale origin persists | Recomputed per declaration node |
| `op=`, `??=` (if/when added) | Hand-copy the rule a third time | One write rule covers all lvalue writes |

**Durable value (regressions prevented, not new bugs):**

| Risk | Mechanism |
|---|---|
| Mutation-rule copy-paste drift | One predicate per concern instead of per-syntax |
| Detection-vs-emitter intent drift | Facts come from a single resolution of lowering intent |
| Gates growing unchecked | Each new rule is a small predicate over facts, not another branch in the 350-line `visit()` |

**Not changed (honest):** no new features, no better C++, no fix for aliasing/
flow-sensitive ownership across expressions, the eight single-site gates gain
little and are left alone in Phase 1.

---

## 4. Architecture

```
                  ┌─────────────────────────────────────────┐
                  │ runSemanticGates(program, userFiles)    │
                  │   unchanged signature & call site       │
                  │   (transpile.ts:374)                    │
                  └───────────────────┬─────────────────────┘
                                      │
                 ┌────────────────────┴───────────────────┐
                 │                                        │
        ┌────────▼─────────┐                   ┌──────────▼──────────┐
        │ SemanticAnalysis │                   │  Gate rules          │
        │  pipeline        │                   │  (predicates over    │
        │  (NEW)           │                   │   facts)             │
        └────────┬─────────┘                   └──────────┬──────────┘
                 │                                         │
   produces      │                            consumes     │
   ┌─────────────▼──────────────┐         ┌────────────────▼──────────────┐
   │ FactStore                  │ ◄────── │ facts.get(node)               │
   │ WeakMap<ts.Node,Facts>     │         │                               │
   │ + CanonicalType resolver   │         │                               │
   └────────────────────────────┘         └───────────────────────────────┘
```

The pipeline runs to completion and populates the `FactStore` before any gate
rule runs. Gate rules are pure predicates over `facts.get(node)`.

### 4.1 Why a pipeline, not one walk

Some facts need enclosing context that is not local to the node
(this is a correction to an earlier "one pass" framing — conceded in review):

- **callback capture** needs nested-function boundary awareness
- **return lifetime** needs the enclosing function's return context
- **map-value-copy mutation** needs declaration origin + later assignment use
- **array/typed-array param mutation** needs scoped binding + mutation target

The pipeline is therefore a small ordered set of passes over the same AST, each
producing a slice of the facts. This is cheaper and lower-risk than threading
all of that context through one visitor.

### 4.2 Why node-keyed, not a new IR

The gate pass runs on original TS source files and finishes before `build-ir.ts`
hoists, splits, or lowers anything (see `transpile.ts:367–380`). TS nodes are
alive and identity-stable for the whole pass, so a `WeakMap<ts.Node, …>` is
correct and has no lifetime hazard. A parallel IR would pay its full cost
(node algebra, bidirectional type mapping, double lowering) and buy nothing for
the gate use case. The node-keyed choice is revisited in §8.

---

## 5. Core types

New module: `packages/cuttlefish/src/orchestrator/semantic-facts.ts`

```ts
import type ts from "typescript";
import type { Diagnostic } from "../types";

/**
 * Canonical type category. Deliberately small — this is NOT a full SType
 * algebra. It exists to stop the six boolean predicates (isMapLikeType,
 * isSetLikeType, isTypedArrayType, isArrayLikeType, isStringLikeType,
 * isPrimitiveLikeValueType) from each calling typeToString() in disguise.
 *
 * Field/return types named to be SIR-compatible: a future promotion to a full
 * SType algebra should be able to widen `category` without renaming consumers.
 */
export type CanonicalType =
  | "primitive"      // number, string, boolean, etc.
  | "struct"         // classes and interfaces (lower to C++ value/struct types)
  | "array"          // Array<T>, T[], tuple -> std::vector / static array
  | "typed-array"    // Int8Array .. Float64Array -> pointer-like storage
  | "map"            // Map, ReadonlyMap, Record -> std::map
  | "set"            // Set, ReadonlySet -> std::set
  | "function"
  | "unknown";       // any, unknown, or unresolvable -> fatal in verifier

/**
 * How an expression's value reaches its use. The categories the current gates
 * care about are: copy (map/record value lookup, by-value param) and reference.
 * temporary/rvalue are reserved for future promotion; not all are populated in
 * Phase 1.
 */
export type ValueCategory =
  | "lvalue"      // addressable, assignable
  | "rvalue"      // pure value
  | "copy"        // value copy from a container lookup or by-value param
  | "reference"   // refers to storage owned elsewhere (e.g. by-ref param)
  | "temporary";  // result of an expression with no stable storage

export type Lifetime =
  | "local"            // function-local variable
  | "param"            // by-value function parameter
  | "param-by-ref"     // by-reference parameter
  | "field"            // class/struct field
  | "global"           // module-level
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
  /** Canonical type category. Verifier requires this to be non-"unknown"
   *  for every expression in user code, else a fatal diagnostic is emitted. */
  type: CanonicalType;
  valueCategory: ValueCategory;
  lifetime: Lifetime;
  nullable: Nullable;
  origin?: SemanticOrigin;
}

/**
 * Read-only view exposed to gate rules.
 *
 * `get` returns undefined for nodes outside user files or nodes the pipeline
 * did not visit. Gate rules treat undefined as "no fact, skip" — they never
 * throw. The verifier (§7) is the only place that asserts presence.
 */
export interface FactStore {
  get(node: ts.Node): Readonly<SemanticFacts> | undefined;
  /** True iff node is in a user file and was visited by the pipeline. */
  has(node: ts.Node): boolean;
}

/**
 * Builds a FactStore for one program. Internally runs the ordered passes
 * (§6). Returns the store plus any fatal diagnostics produced during analysis
 * (e.g. an expression whose type could not be canonicalized).
 *
 * `userFiles` is the same normalized set runSemanticGates already computes
 * (absolute paths, forward slashes, node_modules/packages excluded).
 */
export interface AnalysisResult {
  facts: FactStore;
  /** Fatal analysis diagnostics — appended before gate diagnostics. */
  diagnostics: Diagnostic[];
}

export function buildSemanticFacts(
  program: ts.Program,
  userFiles: string[],
): AnalysisResult;
```

---

## 6. Implementation phases

Phases are independently mergeable. Each phase ends green on the existing suite
(~45 test files in `tests/`, including `transpiler-type-gaps`, `semantic-cpp`,
`demo-4/5-regressions`). No phase changes emitted C++.

### Phase 0 — Skeleton + CanonicalType (no behavior change)

**Deliverables**
- New module `orchestrator/semantic-facts.ts` with the types in §5.
- `buildSemanticFacts` that returns an empty store + zero diagnostics.
- `CanonicalType` resolver that replaces the six boolean predicates
  (`isMapLikeType`, `isSetLikeType`, `isTypedArrayType`, `isArrayLikeType`,
  `isStringLikeType`, `isPrimitiveLikeValueType`) with one function
  `canonicalize(checker, type): CanonicalType`. The existing predicates become
  thin wrappers (`isMapLikeType = (c,t) => canonicalize(c,t) === "map"`) so
  nothing else changes yet.
- Export `buildSemanticFacts` from `testing.ts` for direct unit testing.
- One vitest file `tests/semantic-facts.test.ts` covering the resolver on
  representative types from each category.

**Exit criteria**
- `npm test` green. `runSemanticGates` unchanged. CanonicalType resolver
  exercised by unit tests only; not yet wired into any gate.

**Why first:** isolates the type-string-disguise problem (conceded in review)
from the gate migration. If `canonicalize` misclassifies a type, we find out in
unit tests, not in a gate regression.

### Phase 1 — Fact pipeline + two mutation gates migrated

**Deliverables**
- Implement the ordered passes inside `buildSemanticFacts`. Phase 1 populates
  only the facts the two target gates need:
  1. **Binding origin pass.** For each `VariableDeclaration` and each function
     parameter (and, as a fix for the §1 gaps, each destructuring element,
     `for…of`/`for…in` binding, and `catch` binding), record origin facts on the
     declared identifier node. Reassignment updates the origin on the new
     initializer node.
  2. **Container-lookup pass.** Tag `origin: "map-value-lookup"` on
     `map.get(k)!`, `map.at(k)`, `map[k]` (Map/Record), collapsing the
     `unwrapExpression` wrappers (lines 283–301) at this layer.
  3. **Param category pass.** Tag `origin: "array-param"` / `"typed-array-param"`
     on by-value array / typed-array parameters.
- Rewrite the two gates as predicates over facts:
  - `TS2CPP_MAP_VALUE_COPY_MUTATION` (lines 793–835, both `=` and `++`/`--`
    branches collapse into one rule: any write to an lvalue whose root
    identifier carries `origin: "map-value-lookup"`).
  - `TS2CPP_ARRAY_PARAM_MUTATION` (same two branches; rule: any write whose
    root carries `origin: "array-param"`, plus the mutating-array-method call
    site at lines 889–901).
- Delete `GateScope.mapValueCopyBindings`, `arrayParams`, `typedArrayParams`
  and the `declareBinding`/`lookupScopedSet` machinery that exists only for
  them (`declareBinding` stays if still used for `declaredNames`; otherwise
  removed).
- **Diagnostic parity test:** add a snapshot-style test asserting identical
  diagnostics (code, message, line, hint) between the pre-refactor and
  post-refactor gate output across the existing corpus in `tests/`. This is the
  safety net for the migration.

**Exit criteria**
- Diagnostic parity holds on the existing suite.
- The §1 false-negative cases (destructuring shadowing, `for` binding,
  reassignment) now produce the expected diagnostics — add explicit cases to
  `tests/transpiler-type-gaps.test.ts`.

### Phase 2 — Migrate the remaining duplicated/flow-sensitive gates

In priority order, each migrated only if the fact layer makes it strictly
simpler (otherwise left alone):

1. `TS2CPP_TYPED_ARRAY_PARAM_LENGTH` (lines 839–849) — becomes
   `facts.get(receiver)?.origin === "typed-array-param"`.
2. `TS2CPP_TYPED_ARRAY_RETURN` (lines 853–863 and 605–613) — becomes
   `facts.get(expr)?.type === "typed-array"` inside a return context.
3. `TS2CPP_GET_NULLISH_COMPARE` + `TS2CPP_OPTIONAL_FIELD_NULLISH`
   (lines 750–790) — becomes a check on `nullable` and `origin` fields.
4. `TS2CPP_CALLBACK_CAPTURE_UNSUPPORTED` (lines 913–922) — needs the
   nested-function-boundary pass; migrated only if that pass is cheap, else
   deferred.

**Left alone in Phase 1–2** (single-site, no duplication, no flow sensitivity):
`TS2CPP_HETEROGENEOUS_ARRAY`, `TS2CPP_NEW_ON_INTERFACE`, `TS2CPP_FORIN_ON_MAP`,
`TS2CPP_UNION_MEMBER_ACCESS`, `TS2CPP_DYNAMIC_OBJECT_KEY`,
`TS2CPP_CONTAINER_FUNCTIONAL_METHOD`. Migrating these buys nothing and adds
churn.

**Exit criteria per gate:** diagnostic parity test green; the old inline
detection code deleted (not left as dead code).

### Phase 3 — Fact-completeness verifier

**Deliverables**
- A `verifyFacts(facts, program, userFiles): Diagnostic[]` pass run after
  `buildSemanticFacts` and before gate rules. Four checks (the lightweight set
  conceded in review):
  1. Every expression in user code has a `CanonicalType` other than `"unknown"`
     (else a fatal diagnostic — this catches `any`/`unknown` leakage that
     `feature-prescan` and `strict` don't fully cover).
  2. Every visited node has a fact (no silent gaps from a missed pass).
  3. No gate rule calls the TypeChecker directly. Enforced by a lint rule /
     module boundary: gate-rule modules import from `semantic-facts` only, not
     from `typescript`. (Static check; see §7.)
  4. No fatal diagnostic is emitted after the gate phase boundary (i.e. the
     verifier is the last producer of fatal analysis diags; gates produce only
     rule diags).

**Exit criteria**
- Verifier runs in `runSemanticGates` between analysis and rules.
- Check (3) enforced by a grep-based or eslint-based guard in CI.

> **Note (cppType extension — type-resolution consolidation Phase 3).** The
> verifier's expression walk now also *populates* the FactStore with the
> `SemanticFacts.type` it was already computing (previously ephemeral) plus a
> new optional `SemanticFacts.cppType` field — the concrete C++ type the
> lowering emits, for the categories where it is deterministic from the TS
> type alone (primitives → `double`/`std::string`/`bool`; typed-arrays → their
> element pointer type; structs → their bare name). Categories whose cppType
> depends on IR-build context (array/map/set element types, `auto` deduction)
> leave `cppType` undefined and defer to the ProgramIR `SymbolTable`.
>
> This is forward-compatible infrastructure for sharing a concrete type
> between the gate layer and the IR/emit layer. The data flow is strictly
> **one-way**: gates may *read* `facts.cppType`, but nothing feeds it back
> into the IR/emit `SymbolTable`. The field is populated from the
> `ts.TypeChecker` today; if the pipeline is later reordered to build
> `ProgramIR` before the gates, the `SymbolTable` can populate it directly and
> the `ts.TypeChecker` derivation removed. The verifier and all existing gate
> rules are unaffected — `cppType` is additive and the verifier still uses
> `type` for its `"unknown"` check. See `cppTypeFromCanonicalType` in
> `semantic-facts.ts`.

---

## 7. Boundaries and invariants

- **Gate rules are pure predicates over `FactStore`.** They do not call the
  TypeChecker, do not walk scope chains, do not call `unwrapExpression`. The
  only imports a gate-rule module needs are `FactStore`, `SemanticFacts`, and
  `makeSemanticGateDiagnostic` (for emitting). This is statically enforceable
  and is the guardrail against the layer decaying back into side-channels.
- **`buildSemanticFacts` is the only TypeChecker consumer** in this layer.
- **Facts are immutable from the gate rules' perspective** (`Readonly<>` on the
  `FactStore.get` return). Passes write during the analysis phase only.
- **`runSemanticGates` signature is unchanged** (`(program, userFiles) =>
  Diagnostic[]`). The call site at `transpile.ts:374` and the testing export at
  `testing.ts:59` do not move. Internally it becomes:
  ```ts
  export function runSemanticGates(program, userFiles): Diagnostic[] {
    const { facts, diagnostics: analysisDiags } = buildSemanticFacts(program, userFiles);
    const verifyDiags = verifyFacts(facts, program, userFiles); // Phase 3
    const gateDiags = runGateRules(facts, program, userFiles);
    return [...analysisDiags, ...verifyDiags, ...gateDiags];
  }
  ```
- **Source-span discipline.** Gate diagnostics continue to use
  `makeSemanticGateDiagnostic` (lines 524–536), which already records `source`,
  `sourceLine`, `code`, `hint`. No diagnostic-shape change.

---

## 8. Promotion criterion (the SIR decision, deferred)

The fact layer is node-keyed because the gate pass runs on TS source and the
nodes are alive throughout. This stops being true the moment an **emitter**
wants a fact — by then, `build-ir.ts` has hoisted/split/lowered the nodes and
the `WeakMap` is useless.

**Explicit trigger:** the first concrete request from an emitter
(`emit/cpp-emitter.ts`, `expression-renderer.ts`, etc.) for a semantic fact
prompts a deliberate decision, in its own design doc, between:
- (a) threading the relevant fact onto the IR node it lowers to (cheap, local),
  or
- (b) promoting the fact layer to a real SIR (the full Typed Semantic IR
  proposal).

The default at that point is (a) — local threading — because it preserves the
"don't pre-build" principle. Option (b) is taken only if two or more emitters
need overlapping facts, which is the actual signal that a parallel IR earns its
cost. **The fact layer is designed to grow into SIR** (SIR-compatible field
names, `CanonicalType` as a category that can widen to a full algebra) **but is
not pre-built as SIR.** This satisfies the review's "design it so it can grow"
without paying the structural cost up front.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Phase 1 migration regresses the 45-file test suite | Diagnostic-parity snapshot test added *before* deleting old code; old code deleted only after parity holds. |
| `canonicalize` misclassifies a type the gates relied on | Phase 0 ships the resolver with unit tests and no gate wiring; misclassifications surface in isolation. |
| Pass ordering produces a fact that a later pass overwrites incorrectly | Facts are written by exactly one pass per field (`origin` by the binding/container passes, `type` by the resolver pass, etc.); the verifier (Phase 3, check 2) catches gaps. |
| Scope creep into "while we're here, migrate everything" | Phase 2 has an explicit "only if strictly simpler" gate; the eight single-site gates are listed as deliberately untouched. |
| Emitter later wants a fact and someone threads it ad-hoc | The §8 promotion criterion is documented; the Phase 3 invariant "gates don't touch TypeChecker" makes ad-hoc threading visible by contrast. |

---

## 10. Sizing (rough)

| Phase | New/changed LOC (est.) | Risk |
|---|---|---|
| Phase 0 | ~150 new (module + resolver + tests), ~30 changed (predicates → wrappers) | Low — isolated |
| Phase 1 | ~300 new (passes + fact store), ~−150 deleted (scope machinery + duplicated rule branches), ~+1 parity test | Medium — the migration step |
| Phase 2 | ~−100 net per migrated gate (old inline code removed) | Low per gate |
| Phase 3 | ~120 new (verifier + boundary guard) | Low |

Total: roughly +400 net LOC across all phases, with the bulk of the value
(duplicated-rule collapse + §1 false-negative fixes) landing in Phase 1.

---

## 11. Open questions for review

1. **`CanonicalType` granularity for "struct".** Classes lower to reference
   types and interfaces to value types in the current emitter. Should
   `CanonicalType` distinguish `class` from `interface-as-value`, or is
   `struct` + a separate `reference: boolean` field cleaner? Phase 0 can ship
   `struct` undifferentiated; split later if a gate needs it.
2. **`valueCategory` population scope.** Phase 1 needs `copy` and `lvalue`.
   Should `reference` / `temporary` be populated speculatively or left unset
   until a consumer appears? Default: leave unset (`undefined`), populate on
   demand.
3. **Verifier fatal-vs-warning for `"unknown"` type.** `any`/`unknown` today
   surface via `feature-prescan` and `strict`. Should the fact verifier make
   them fatal here too, or only when a gate actually consumes the fact? Default:
   fatal at the verifier, to keep the "no fatal after gate boundary" invariant
   meaningful — but this may surface new errors in existing demos and needs a
   trial run before Phase 3 merges.
