# gen-decls: C++ class inheritance support

**Date:** 2026-06-20
**Status:** Approved (pending spec review)
**Package:** `@typecad/cuttlefish`
**Affected files:** `packages/cuttlefish/src/libdef/cpp-to-decl.ts`, `packages/cuttlefish/src/cli.ts`

## Problem

`cuttlefish gen-decls` generates a `.d.ts` per `.cpp` file by parsing class
definitions and `ClassName::method` scope-resolution. It has two gaps that
break typed usage of Arduino display libraries like Adafruit_GFX:

1. **Inheritance is dropped.** `class Adafruit_ILI9341 : public Adafruit_SPITFT`
   is declared in a `.h` header, but gen-decls only reads `.cpp` files and its
   class regex ignores the `: public Base` clause entirely. The generated
   `Adafruit_ILI9341.d.ts` declares a flat class with only `begin()`,
   `setRotation()`, etc. — a typed instance loses `fillRect()`, `drawRect()`,
   `print()` inherited through `Adafruit_SPITFT → Adafruit_GFX → Print`.

2. **Headers aren't parsed at all.** The class declaration (with base class,
   access specifiers, full constructor signatures) lives in `.h`; the `.cpp`
   only carries implementations. Today gen-decls infers class shape from
   `ClassName::method` in the `.cpp`, which misses the header's richer info
   and produces near-empty stubs for classes whose `.cpp` barely references
   them.

### Concrete inheritance chains in scope

```
Print                         (Arduino core — no header in lib/)
  └─ Adafruit_GFX             (lib/Adafruit_GFX_Library/Adafruit_GFX.h)
       ├─ Adafruit_GrayOLED   (lib/Adafruit_GFX_Library/Adafruit_GrayOLED.h)
       ├─ Adafruit_SPITFT     (lib/Adafruit_GFX_Library/Adafruit_SPITFT.h)
       │    └─ Adafruit_ILI9341 (lib/Adafruit_ILI9341/Adafruit_ILI9341.h)
       └─ GFXcanvas1/8/16     (lib/Adafruit_GFX_Library/Adafruit_GFX.h)
```

## Goals

- Emit `extends Base` on generated classes when the C++ header declares
  inheritance, so typed instances inherit all base-class methods.
- Resolve cross-file base classes (e.g. `Adafruit_SPITFT` lives in a sibling
  library directory) by emitting the correct relative `import type`.
- Handle unresolved bases (e.g. Arduino core `Print`) without breaking TS
  compilation.
- Parse `.h` headers alongside `.cpp` files, with headers as the source of
  truth for class structure and `.cpp` contributing implementation-only
  methods.
- Stay dependency-free (no tree-sitter, no clang).

## Non-goals

- Full C++ parsing: templates, nested classes, namespaces, multiple
  inheritance beyond the first base. These don't appear in the target Adafruit
  headers; the regex will simply not match them (no crash).
- `#define` constants (`#define ILI9341_PINK 0xFC18`). Out of scope; the user
  report focused on methods and inheritance.
- Resolving base classes outside the `--all` scan path. The resolver is scoped
  to the scanned directory only (no parent climbing) — predictable, no
  surprise file reads.
- Preserving conditionally-compiled (`#if`-guarded) methods. `#if` blocks are
  stripped wholesale in v1.

## Architecture

Three units in `packages/cuttlefish/src/libdef/`, each with one purpose:

### 1. `header-parser.ts` (new)

Parses a single `.h` file into `ParsedClass[]`. Extends the existing regex
approach but targets header syntax.

**Class declaration regex** (extends the current `class X {` pattern):
```
class\s+(\w+)\s*(?::\s*(?:public|protected|private)\s+(\w+))?\s*\{
```
- Captures `baseClass?` (group 2, optional). Only the first base is captured;
  multiple inheritance (`, public B`) is ignored — documented limitation.

**Preprocessor stripping (before parsing):**
- Remove whole `#if`/`#ifdef`/`#ifndef` … `#endif` blocks. Naive
  implementation: track nesting, strip from `#if*` to its matching `#endif`.
  This loses conditionally-compiled methods (e.g. the `SPIClass*` constructor
  guarded by `#if !defined(ESP8266)` in `Adafruit_ILI9341.h`). Documented
  trade-off; narrower emitted API is preferable to parse failure.

**Returns** the existing `CppClass` shape plus:
```typescript
interface CppClass {
  name: string;
  methods: CppMethod[];
  constructors: { parameters: { type: string; name: string }[] }[];
  baseClass?: string;                          // NEW
  source: "header" | "cpp";                    // NEW
}
```

### 2. `base-class-resolver.ts` (new)

Given a class name and a scan root, finds where it's declared.

**Index** — `Map<className, headerFilePath>`, built once per directory scan by
walking all `.h` files under the scan root and running the class regex on
each. Stored in declaration order (first wins) to keep behavior deterministic.

**Name collisions:** if the same class name is declared in two headers under
the scan root, the first one encountered (directory-walk order) wins and is
the import target. No warning is emitted in v1. This is rare for real
Arduino libraries (class names are globally unique by convention); if it
becomes a problem, a diagnostic can be added later without changing the
resolver contract.

**API:**
```typescript
class BaseClassResolver {
  constructor(index: Map<string, string>);
  resolve(name: string): { kind: "found"; headerPath: string }
                        | { kind: "external" };
}
```

- `resolve` returns `found` with the header's absolute path if the class is
  indexed; `external` otherwise.
- Scoped to whatever the scan root was — no parent-directory climbing.

### 3. `cpp-to-decl.ts` (extended — orchestration only)

`CppClass` gains `baseClass?` and `source`. Public functions change shape:

**`generateDecl(filePath: string, outputPath?: string): string | null`**
- Accepts `.h` or `.cpp` (replaces `generateDeclFromCpp`).
- For `.cpp`: if a sibling `.h` exists (same basename), parse it and merge.
  Header wins for `baseClass` and access specifiers; `.cpp` contributes
  methods seen only via `ClassName::method` scope resolution. If no sibling
  header, behave as today (flattened, no base).
- For `.h`: parse the header; optionally read sibling `.cpp` for impl-only
  methods.
- Emits `.d.ts` next to the input with the same basename.

**`generateDeclsForDirectory(dir, recursive = true): string[]`**
- Pass 1: walk all `.h` under `dir`, build the resolver index
  (`Map<className, headerPath>`).
- Pass 2: for each `.h`, parse + merge with sibling `.cpp` if present →
  emit `.d.ts`. For each `.cpp` with no sibling `.h`, parse alone → emit
  `.d.ts` (today's behavior).
- Idempotence check unchanged: skip if `.d.ts` exists and content matches.

`generateDeclFromCpp` is kept as a thin wrapper delegating to
`generateDecl` for backward compat (it's imported from `cli.ts`).

## Emitter rules

Per-header `.d.ts` emission. The `.d.ts` sits next to its source `.h` (or
`.cpp` for header-less classes).

For each class with a `baseClass`, the emitter resolves it:

1. **Same-file base.** The base is also declared in this `.h` (e.g.
   `Adafruit_GFX.h` declares both `Adafruit_GFX` and
   `GFXcanvas1 : public Adafruit_GFX`). Emit `extends Adafruit_GFX`, no
   import.

2. **Cross-file, resolvable.** Base found in another scanned header. Emit a
   relative `import type` at the top of the file, POSIX-style path:
   ```typescript
   import type { Adafruit_SPITFT } from "../Adafruit_GFX_Library/Adafruit_SPITFT";
   export declare class Adafruit_ILI9341 extends Adafruit_SPITFT { ... }
   ```
   Path computed from the emitting `.d.ts` location to the target `.d.ts`
   location via `path.relative`, then normalized to POSIX (`/`) — TypeScript
   requires forward slashes in import paths.

3. **External / unresolved.** Base not in any scanned header (e.g. `Print`).
   Emit an empty stub above the class:
   ```typescript
   declare class Print {}
   export declare class Adafruit_GFX extends Print { ... }
   ```
   No methods, no import. Keeps TS compiling; user enriches later.

**Import/stub collection.** A file may reference multiple external bases.
Collect all `import type` lines and all stubs first, dedupe by name, emit
imports as a block at the top, then constants, then stubs, then classes.

**Class body.** Unchanged: constructors (deduped by param count), public
methods only. Inherited methods are NOT re-declared — TS resolves them
through `extends`.

**`.cpp`-only inferred classes.** A class seen only via `ClassName::method`
in a `.cpp` (no header) emits with no base class, as today. No regression.

## Single-file vs directory scan

**Single-file mode (`gen-decls <file>`):**
- Now accepts `.h` in addition to `.cpp`.
- The `.cpp`-only assertion in `cli.ts` relaxes:
  ```typescript
  if (extension !== ".cpp" && extension !== ".h") { throw ... }
  ```
- Single-file mode has no scan root, so base resolution treats every base as
  "external" → empty stub. No cross-file imports in single-file mode.

**Directory scan (`gen-decls --all <dir>`):**
- Now processes `.h` files (today: only `.cpp`).
- Emits a `.d.ts` per `.h`. For a `.cpp` with no sibling `.h`, still emits a
  `.d.ts` (today's behavior).
- Resolver index built from all `.h` under the scan path only.

**Behavior change flagged:** in single-file mode, `gen-decls Adafruit_GFX.cpp`
will now merge its sibling `Adafruit_GFX.h` if present, producing a richer
declaration (with base class and full method signatures) than the old
`.cpp`-only flattened output. This is the intended fix for the reported gap.

## Preprocessor & edge-case handling

| Case | Behavior |
|------|----------|
| `#if`/`#ifdef`/`#ifndef` blocks | Stripped wholesale before parsing. Nested `#if` tracked. Conditionally-compiled methods are lost. |
| `#include`, `#define`, `#pragma` | Ignored (unchanged from today). |
| `#define` color constants | Not parsed. Out of scope. |
| Templates, nested classes | Regex won't match; silently skipped. No crash. |
| Multiple inheritance (`: public A, public B`) | Only first base captured. Documented limitation. |
| Access specifiers (`public:`/`private:`/`protected:`) | Reused from current parser. |
| `.cpp`-only classes (no header) | Flattened, no base class. Unchanged. |

## Testing strategy

New test file: `tests/packages/transpiler/gen-decls-inheritance.test.ts`,
with fixture `.h`/`.cpp` pairs under `tests/fixtures/cpp-inheritance/`:

- **Single-lib inheritance** — `Adafruit_GFX.h` declaring `Adafruit_GFX` and
  `GFXcanvas1 : public Adafruit_GFX` in the same file → no import, direct
  `extends`.
- **Cross-lib inheritance** — two fixture lib dirs
  (`fixtures/libA/Dependent.h`, `fixtures/libB/Base.h`) → `import type` with
  correct relative POSIX path.
- **Unresolved base** — `class Foo : public Print` with no `Print` in
  fixtures → empty `declare class Print {}` stub.
- **`.cpp` + `.h` merge** — header supplies base class + constructor
  signatures, `.cpp` supplies an impl-only method via `Foo::bar()` → merged
  declaration.
- **`#if` block stripping** — header with a constructor guarded by
  `#if !defined(ESP8266) … #endif` → that constructor absent from output.
- **Single-file `.h` input** — `gen-decls Foo.h` produces `Foo.d.ts`; base
  treated as external → stub.

Fixtures are committed to the repo (small, hand-written `.h`/`.cpp` pairs —
not the real Adafruit sources, which are large and under their own license).

## Backward compatibility

- `generateDeclFromCpp` retained as a wrapper around `generateDecl` so
  existing imports (`cli.ts`) keep working.
- Existing `.cpp`-only flow (no sibling header) is unchanged in output.
- The only output change for existing inputs is the *intended* one: a `.cpp`
  with a sibling `.h` now merges the header, producing base-class-aware
  declarations.
- CLI surface unchanged beyond the `.h` extension acceptance in single-file
  mode.

## Out of scope / future work

- Conditionally-compiled (`#if`) method preservation.
- `#define` constant emission.
- Multiple inheritance beyond the first base.
- Templates and nested classes.
- Resolver climbing beyond the scan path.
- A `--force` flag to regenerate `.d.ts` even when content matches (today
  the idempotence check skips; this is unchanged).
