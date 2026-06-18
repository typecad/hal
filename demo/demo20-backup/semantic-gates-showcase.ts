// ---------------------------------------------------------------------------
// semantic-gates-showcase.ts
//
// This file is NOT part of the transpile graph (main.ts does not import it).
// It is a documentation showcase of the **semantic gates** the cuttlefish
// transpiler now enforces — the kind of bugs that, before these gates, would
// compile to C++ that either failed in the compiler (leaking raw g++ errors
// back to the user) or, worse, compiled and ran with silently-wrong behavior.
//
// Each block below is a real bug pattern. The snippets are commented out
// because the gates reject them at the diagnostic stage — uncommenting any one
// and transpiling it produces a clear, source-located `TS2CPP_*` diagnostic
// instead of a raw C++ error or a silent miscompilation.
//
// The gates are powered by the SemanticFacts layer (see
// packages/cuttlefish/src/orchestrator/semantic-facts.ts): a precomputed,
// node-keyed fact map that resolves every binding to its value origin
// (map-value-copy, array-param, typed-array-param, ...) so the gates reason
// about *what a value is* rather than re-deriving it from syntax at every use
// site. This file highlights what that buys you.
// ---------------------------------------------------------------------------

// ===========================================================================
// 1.  TS2CPP_MAP_VALUE_COPY_MUTATION
// ===========================================================================
//   `Map.get(k)` / `Record[k]` on a struct/container returns the value BY
//   COPY in the C++ lowering (std::map::at returns a value, not a reference).
//   Mutating a field on that copy silently does nothing — the container is
//   never updated. Before this gate, this compiled and ran with the mutation
//   lost.
//
//   The gate catches the mutation regardless of how the copy is bound,
//   including forms the older per-scope detector missed:

// --- 1a. The classic form: const t = map.get(k)!; t.field = ... -----------
// interface Task { done: boolean; }
// function complete(tasks: Map<string, Task>, id: string): void {
//   const task = tasks.get(id)!;
//   task.done = true;   // ← TS2CPP_MAP_VALUE_COPY_MUTATION: writes a copy, not the map
// }

// --- 1b. NEWLY CAUGHT: destructuring ----------------------------------------
//   The old name-based scope detector never registered destructuring bindings,
//   so this slipped through. The node-keyed fact layer records the origin on
//   every binding form.
// interface Box { task: { done: boolean } }
// function completeBox(boxes: Map<string, Box>, id: string): void {
//   const { task } = boxes.get(id)!;
//   task.done = true;   // ← TS2CPP_MAP_VALUE_COPY_MUTATION (was a false negative)
// }

// --- 1c. Every write operator, one rule -------------------------------------
//   `=`, `+=`, `-=`, `++`, `--` are all caught by a single predicate over the
//   resolved origin — no per-operator copies to drift.
// interface Counter { n: number; }
// function bump(counters: Map<string, Counter>, id: string): void {
//   const c = counters.get(id)!;
//   c.n += 1;           // ← TS2CPP_MAP_VALUE_COPY_MUTATION
//   c.n++;              // ← TS2CPP_MAP_VALUE_COPY_MUTATION (same rule, postfix form)
// }

// --- 1d. NEWLY CORRECT: reassignment clears the copy origin -----------------
//   If the binding is reassigned to a non-copy value, later mutation is fine.
//   The fact layer recomputes the origin on each assignment initializer.
// interface Task { done: boolean; }
// function ok(tasks: Map<string, Task>, id: string, other: Task): void {
//   let task = tasks.get(id)!;
//   task = other;       // origin is now a plain local — no longer a copy
//   task.done = true;   // ← NOT flagged (correct: this writes `other`)
// }

// The correct pattern, for reference: read the value out, mutate, .set() back.
//   const current = tasks.get(id)!;
//   current.done = true;
//   tasks.set(id, current);   // writes the whole entry back


// ===========================================================================
// 2.  TS2CPP_ARRAY_PARAM_MUTATION
// ===========================================================================
//   Array parameters lower to by-value std::vector copies. Mutating the
//   parameter (by index, by mutating method) changes only the local copy —
//   the caller's array is untouched. Before this gate this compiled and ran
//   with the caller's array unmodified.

// function addOne(scores: number[]): void {
//   scores[0] = scores[0]! + 1;   // ← TS2CPP_ARRAY_PARAM_MUTATION: writes a copy
//   scores.push(99);              // ← TS2CPP_ARRAY_PARAM_MUTATION: .push on a copy
// }


// ===========================================================================
// 3.  TS2CPP_TYPED_ARRAY_PARAM_LENGTH
// ===========================================================================
//   Typed-array parameters (Uint8Array, Float64Array, ...) lower to pointer-
//   like storage. Their `.length` is not recoverable from the parameter, so
//   reading it has no valid lowering.

// function firstByte(buf: Uint8Array): number {
//   return buf[0]!! ;             // indexing is fine (it's pointer arithmetic)
// }
// function bufLength(buf: Uint8Array): number {
//   return buf.length;            // ← TS2CPP_TYPED_ARRAY_PARAM_LENGTH: no lowering for .length
// }


// ===========================================================================
// 4.  TS2CPP_UNCLASSIFIABLE_TYPE  (Phase 3 completeness verifier)
// ===========================================================================
//   The verifier walks every expression and flags any whose type the
//   classifier cannot map to a C++ concept. This catches constructs that
//   would otherwise fall through to verbatim emit or `0 /* unsupported */`.
//
//   Note what is NOT flagged: `any` (the transpiler's inference path),
//   `this` types, nullable unions (`T | null`), and the cuttlefish C++ type
//   aliases (double, int32_t, ...) are all classified and pass cleanly. Only
//   genuinely unclassifiable types surface.

// --- 4a. A discriminated string-literal union (a genuine hazard) -----------
//   These lower to std::variant with caveats, so the verifier surfaces them.
// type Status = "ok" | "err" | "pending";
// function label(s: Status): Status {
//   return s;                      // ← TS2CPP_UNCLASSIFIABLE_TYPE (warning): string-literal union
// }

// --- 4b. Explicit `unknown` -------------------------------------------------
// function risky(x: unknown): unknown {
//   return x;                      // ← TS2CPP_UNCLASSIFIABLE_TYPE (warning): no C++ target
// }


// ===========================================================================
// What the gates replace: the old failure mode
// ===========================================================================
//
// Before these gates, the patterns above either:
//   (a) compiled to invalid C++ and surfaced as a raw g++ error (e.g.
//       `'Array' was not declared in this scope` or 26 rejected
//       `operator==` candidates) mapped back to a TS span, or
//   (b) compiled and ran with the mutation silently lost — no diagnostic at
//       all, just a wrong result.
//
// Both are bad: (a) is hostile to users who don't read C++; (b) is worse
// because it's invisible. The semantic gates turn both into a single clear
// `TS2CPP_*` diagnostic at the TS source location, with an actionable hint,
// before any C++ is emitted.
//
// See demo/README.md "Findings" for the historical g++ errors these patterns
// produced, and packages/cuttlefish/src/orchestrator/semantic-facts.ts for
// the fact layer that powers the detection.
