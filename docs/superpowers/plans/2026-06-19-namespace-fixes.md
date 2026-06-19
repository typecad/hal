# Namespace-scoped construct fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three namespace-scoped-construct bugs surfaced by the class stress test (`demo/STRESS_TEST_FINDINGS.md`) so namespace-nested classes, namespace member access, and namespace-scope constants behave identically to their top-level counterparts.

**Architecture:** All three bugs are one family — namespace-scoped declarations aren't treated with the same fidelity as top-level ones across the emit pipeline. Three surgical fixes at three verified sites: (1) the namespace-emitter's class-field renderer drops the `static` prefix that its method renderer applies; (2) the statement-renderer's assignment-target path doesn't convert namespace-member `.` to `::`; (3) namespace `const`/`let` bindings aren't registered in the type-resolution map the snprintf operand picker consults. Order: static-field fix → `::` fix → type-map fix (each independently testable).

**Tech Stack:** TypeScript, vitest, the cuttlefish emit pipeline (`packages/cuttlefish/src/emit/`). Tests use `transpile`/`transpileArduino` from `tests/setup.ts`.

**Source findings doc:** `demo/STRESS_TEST_FINDINGS.md`

---

## File Structure

**Modify (all under `packages/cuttlefish/src/`):**
- `emit/emitters/namespace-emitter.ts` — add the `static` prefix to the three class-field render loops (public/private/protected). (Fix 1)
- `emit/statement-renderer.ts` — convert namespace-member `.` → `::` on assignment targets. (Fix 2)
- `emit/emitters/setup.ts` — register namespace `const`/`let` bindings in `topLevelScope.knownVariableTypes` so the snprintf operand resolver sees their type. (Fix 3)

**Test (create):**
- `tests/packages/transpiler/namespace-regressions.test.ts` — one `describe` per fix.

**Verification (last task):**
- `demo/src/main.ts` — restore the stress-test's natural forms (un-comment the workarounds) and confirm `npm run compile` is clean.

---

## Task 1: Fix — static fields on namespace-nested classes keep their `static` qualifier

**Files:**
- Modify: `packages/cuttlefish/src/emit/emitters/namespace-emitter.ts:151-155, 178-182, 196-200`
- Test: `tests/packages/transpiler/namespace-regressions.test.ts` (create)

- [ ] **Step 1: Create the regression test file with the failing static-field test**

Create `tests/packages/transpiler/namespace-regressions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { transpileArduino } from "../../setup";

// ── Fix 1: a static field on a class nested in a namespace keeps `static` ──
// Today the namespace-emitter's field render omits the `static` prefix (its
// method render applies one), so `static count` emits as an instance field
// and a static method's `Registry.count` access fails.
describe("namespace: static field on a namespace-nested class", () => {
  it("emits `static inline` for a static field (matches top-level classes)", () => {
    const src = `
namespace Devices {
  export class Registry {
    static count: int32_t = 0;
    static bump(): int32_t {
      Devices.Registry.count = Devices.Registry.count + 1;
      return Devices.Registry.count;
    }
  }
}
console.log('' + Devices.Registry.bump());
`;
    const res = transpileArduino(src);
    // The field must render as static (the top-level form is `static inline`).
    expect(res.cpp).toMatch(/static\s+(inline\s+)?int32_t\s+count/);
    // It must NOT render as a non-static instance field inside the class body.
    expect(res.cpp).not.toMatch(/^\s+int32_t\s+count\s*=\s*0;/m);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/packages/transpiler/namespace-regressions.test.ts`
Expected: FAIL — the field renders as `int32_t count = 0;` (no `static`).

- [ ] **Step 3: Read the namespace-emitter field render to confirm the edit site**

Read `packages/cuttlefish/src/emit/emitters/namespace-emitter.ts` lines 151-214. Confirm there are THREE identical field-render loops (public at 151-155, private at 178-182, protected at 196-200), each emitting `${renderTypedName(fieldType, field.name)}${initSuffix};` with NO static prefix, while the method loops (e.g. line 159) compute `const staticPrefix = method.isStatic ? "static " : "";`. The field loops must gain the same prefix.

- [ ] **Step 4: Apply the static prefix to all three field render loops**

In `packages/cuttlefish/src/emit/emitters/namespace-emitter.ts`, the public-fields loop (lines 151-155) currently is:

```ts
        for (const field of publicFields) {
          const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
          const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
          appendSourceLine(ctx, `    ${renderTypedName(fieldType, field.name)}${initSuffix};`);
        }
```

Replace it with (adding the `static` prefix, matching the method-render convention and the top-level class-emitter's `static inline` form):

```ts
        for (const field of publicFields) {
          const initSuffix = field.initializer ? ` = ${renderExpression(field.initializer, undefined)}` : "";
          const fieldType = strategy.overrideClassFieldType(field.name, normalizeCppTypeForTarget(field.cppType));
          // Mirror the method-render prefix (line ~159) and the top-level
          // class-emitter: a static field renders as `static inline` so a
          // static method's `Cls::field` access resolves. Without this, a
          // static field on a namespace-nested class silently dropped to an
          // instance field (namespace stress test Finding 2).
          const staticPrefix = field.isStatic ? "static inline " : "";
          appendSourceLine(ctx, `    ${staticPrefix}${renderTypedName(fieldType, field.name)}${initSuffix};`);
        }
```

Apply the IDENTICAL change (add `const staticPrefix = field.isStatic ? "static inline " : "";` and prepend `${staticPrefix}`) to the private-fields loop (lines 178-182) and the protected-fields loop (lines 196-200). All three loops must be consistent.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/packages/transpiler/namespace-regressions.test.ts`
Expected: PASS (1 test). The field now renders `static inline int32_t count = 0;`.

- [ ] **Step 6: Run the namespace + class emit suites for regressions**

Run: `npx vitest run tests/packages/transpiler/ tests/classes.test.ts tests/semantic-cpp.test.ts`
Expected: all PASS. The change only ADDS a prefix for `isStatic` fields; non-static fields are unaffected (`staticPrefix = ""`).

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/emit/emitters/namespace-emitter.ts tests/packages/transpiler/namespace-regressions.test.ts
git commit -m "fix(emit): static fields on namespace-nested classes keep static (namespace Finding 2)"
```

---

## Task 2: Fix — namespace member access on assignment targets uses `::`

**Files:**
- Modify: `packages/cuttlefish/src/emit/statement-renderer.ts:265-266`
- Test: `tests/packages/transpiler/namespace-regressions.test.ts` (append Fix-2 block)

- [ ] **Step 1: Append the failing Fix-2 test**

Append to `tests/packages/transpiler/namespace-regressions.test.ts`:

```ts
// ── Fix 2: namespace member access on an assignment target uses :: ─────────
// `Devices.x = ...` must emit `Devices::x = ...`. A namespace is not an
// object, so `.` is a parse error. The property-READ path already does this
// (expression-renderer uses namespaceNames); the assign-TARGET path did not.
describe("namespace: member access on assignment target uses ::", () => {
  it("emits Devices::x on assignment (not Devices.x)", () => {
    const src = `
namespace Devices {
  export let total: int32_t = 0;
  export function add(n: int32_t): void {
    Devices.total = Devices.total + n;
  }
}
Devices.add(5);
console.log('' + (Devices.total as int32_t));
`;
    const res = transpileArduino(src);
    // Every Devices member access — including the assignment TARGET — must
    // use ::, never a bare `Devices.`.
    expect(res.cpp).not.toMatch(/Devices\./);
    expect(res.cpp).toMatch(/Devices::total/);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npx vitest run tests/packages/transpiler/namespace-regressions.test.ts -t "assignment target"`
Expected: FAIL — the emitted cpp contains `Devices.total = Devices::total + n;` (the target kept `.`).

- [ ] **Step 3: Read the assign-target render path to confirm the edit site**

Read `packages/cuttlefish/src/emit/statement-renderer.ts` lines 258-270. The target is built at line 265: `let target = escapeTrailingMember(statement.target, this.strategy.reservedNames());`. This `target` string is then used verbatim. It never consults `this.namespaceNames` to convert a `<NamespaceName>.<member>` target to `<NamespaceName>::<member>`. Confirm `this.namespaceNames` is available on the renderer (it is — same field as expression-renderer; verify by grepping `namespaceNames` in the file).

- [ ] **Step 4: Add a namespace-target rewrite helper and apply it**

In `packages/cuttlefish/src/emit/statement-renderer.ts`, immediately after line 266 (`target = this.arrowGlobalPointerTarget(target);`), add a rewrite that converts a leading `<NamespaceName>.` to `<NamespaceName>::` when the leading identifier is a known namespace. Insert:

```ts
        target = this.arrowGlobalPointerTarget(target);
        // A namespace member used as an ASSIGNMENT TARGET must use `::`
        // (scope resolution), not `.` — a namespace is not an object. The
        // property-READ path already does this via namespaceNames; the
        // assign-target path did not, so `Devices.total = ...` emitted with
        // `.` and failed at g++ time (namespace stress test Finding 3).
        const nsTargetMatch = target.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/);
        if (nsTargetMatch && this.namespaceNames.has(nsTargetMatch[1])) {
          target = target.replace(/^([A-Za-z_$][\w$]*)\./, "$1::");
        }
```

Confirm `this.namespaceNames` exists on `StatementRenderer` (grep `namespaceNames` in the file; if it is not a field, add `private readonly namespaceNames: Set<string>;` initialized from the constructor context the same way `ExpressionRenderer` does at expression-renderer.ts:129 — read that constructor line to mirror it).

- [ ] **Step 5: Run the Fix-2 test to verify it passes**

Run: `npx vitest run tests/packages/transpiler/namespace-regressions.test.ts -t "assignment target"`
Expected: PASS — every `Devices` member access uses `::`, including the target.

- [ ] **Step 6: Run the transpiler + statement suites for regressions**

Run: `npx vitest run tests/packages/transpiler/ tests/statements.test.ts tests/semantic-cpp.test.ts`
Expected: all PASS. The rewrite only fires when the leading identifier is a known namespace name; a `this.x` or `obj.field` target is unaffected.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/emit/statement-renderer.ts tests/packages/transpiler/namespace-regressions.test.ts
git commit -m "fix(emit): namespace member access on assign targets uses :: (namespace Finding 3)"
```

---

## Task 3: Fix — namespace `const`/`let` bindings registered in the type-resolution map

**Files:**
- Modify: `packages/cuttlefish/src/emit/emitters/setup.ts:442` (and the namespace walk)
- Test: `tests/packages/transpiler/namespace-regressions.test.ts` (append Fix-3 block)

- [ ] **Step 1: Append the failing Fix-3 test**

Append to `tests/packages/transpiler/namespace-regressions.test.ts`:

```ts
// ── Fix 3: namespace const in a string concat formats with the right spec ─
// A namespace-scope `const string` used in a concat must be `%s` (with
// .c_str()), not the `%d` default. Today namespace consts aren't in the
// knownVariableTypes map the snprintf operand resolver consults.
describe("namespace: const in concat uses correct snprintf specifier", () => {
  it("formats a namespace const string as %s (not %d)", () => {
    const src = `
namespace Devices {
  export const LABEL: string = "dev";
  export function tag(id: int32_t): string {
    return Devices.LABEL + ":" + id;
  }
}
console.log(Devices.tag(3));
`;
    const res = transpileArduino(src);
    // The LABEL operand must drive a %s slot (string), not %d. The snprintf
    // format for `LABEL + ":" + id` must contain %s and LABEL.c_str().
    expect(res.cpp).toMatch(/%s.*%d|%d.*%s/);
    expect(res.cpp).toMatch(/LABEL\.c_str\(\)/);
    // Must NOT pass LABEL straight to a %d slot.
    expect(res.cpp).not.toMatch(/"%d:%d",\s*Devices::LABEL/);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npx vitest run tests/packages/transpiler/namespace-regressions.test.ts -t "snprintf specifier"`
Expected: FAIL — the emitted format is `"%d:%d"` with `Devices::LABEL` passed to the first `%d` (no `.c_str()`).

- [ ] **Step 3: Read the top-level const registration to mirror it for namespaces**

Read `packages/cuttlefish/src/emit/emitters/setup.ts` around line 442 (`topLevelScope.knownVariableTypes.set(name, { cppType });`). Find the loop that registers TOP-LEVEL `const`/`let` declarations into `knownVariableTypes`. Then find where `program.namespaces` is walked (a `for (const ns of program.namespaces)` loop exists around line 102 for `namespaceNames.add`). The fix adds a parallel registration of each namespace's `constants` (`ns.constants`) into `topLevelScope.knownVariableTypes`, keyed by name, so the snprintf operand resolver (which reads `knownVariableTypes`) sees them.

- [ ] **Step 4: Register namespace constants in knownVariableTypes**

In `packages/cuttlefish/src/emit/emitters/setup.ts`, find the namespace-walk loop (the one containing `namespaceNames.add(ns.name)` around line 102). Within or right after it, add a recursive walk that registers every namespace constant's type. Use a local helper to handle nested namespaces:

```ts
    // Register namespace-scope const/let types in knownVariableTypes so the
    // snprintf operand resolver (and other type-resolution consumers) see
    // them — otherwise a namespace `const string` used in a concat fell
    // through to the %d default (namespace stress test Finding 3b). Mirrors
    // the top-level const registration at ~line 442.
    const registerNsConstants = (ns: typeof program.namespaces[number]): void => {
      for (const c of ns.constants) {
        topLevelScope.knownVariableTypes.set(c.name, { cppType: c.cppType });
      }
      for (const child of ns.children ?? []) registerNsConstants(child);
    };
    for (const ns of program.namespaces) registerNsConstants(ns);
```

Place this in the same scope where `topLevelScope` and `program.namespaces` are both in scope (the same region as the existing `namespaceNames.add` loop). Verify `ns.constants` and `ns.children` match the `NamespaceIR` shape from `namespace-builder.ts:200-202` (they do: `constants` and optional `children`).

- [ ] **Step 5: Run the Fix-3 test to verify it passes**

Run: `npx vitest run tests/packages/transpiler/namespace-regressions.test.ts -t "snprintf specifier"`
Expected: PASS — the format is now `"%s:%d"` (or `%s...%d`) with `Devices::LABEL.c_str()`.

- [ ] **Step 6: Run the full transpiler suite for regressions**

Run: `npx vitest run tests/packages/transpiler/ tests/semantic-cpp.test.ts`
Expected: all PASS. Adding type entries for namespace constants can only make the resolver MORE accurate; no existing behavior regresses (a namespace const that was previously `auto`/`%d` now resolves to its real type).

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/emit/emitters/setup.ts tests/packages/transpiler/namespace-regressions.test.ts
git commit -m "fix(emit): register namespace const/let types for snprintf resolution (namespace Finding 3b)"
```

---

## Task 4: Restore the stress-test's natural forms and verify end-to-end

**Files:**
- Modify: `demo/src/main.ts` (un-comment the three workarounds)

This task confirms all three fixes together by removing the stress-test's workarounds.

- [ ] **Step 1: Restore the natural namespace forms in demo/src/main.ts**

In `demo/src/main.ts`, revert the three STRESS-NOTE workarounds to their natural forms:
- **Finding 2:** restore `Devices.Registry` to use `static count: int32_t = 0;` with `Registry.count` access (remove the `registryCount` namespace-let workaround).
- **Finding 3:** restore the static method to mutate `Registry.count` (the `::` fix makes `Devices.Registry.count = ...` valid).
- **Finding 3b:** restore `makeLabel` to `return DEFAULT_LABEL + ":" + id;` (remove the local-let rebuild).

Do NOT restore the `super.method()` call (line ~71) — that is a separate family (§4.4, demo #36 Finding A) not covered by this plan; leave its workaround in place with its STRESS-NOTE.

- [ ] **Step 2: Run npm run compile in demo/ and confirm clean**

Run: `cd demo && npm run compile`
Expected: exit 0, Flash/RAM reported, no errors. The `heap-allocation-avr` warnings for `new` are expected and fine.

- [ ] **Step 3: Inspect the emitted .ino to confirm the namespace forms are correct**

Run (from `demo/`): `grep -n "static.*count\|Devices::\|LABEL" src/out/main/main.ino | head`

Confirm:
- `static inline int32_t count = 0;` inside `class Registry` (Finding 2 fixed).
- `Devices::Registry::count = ...` (Finding 3 fixed — `::` on the target).
- `Devices::LABEL.c_str()` in the `makeLabel` snprintf (Finding 3b fixed — `%s`).

- [ ] **Step 4: Run the full test suite once more**

Run: `npx vitest run` (from repo root)
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add demo/src/main.ts
git commit -m "stress test: restore natural namespace forms (all three namespace fixes landed)"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage:** Each finding in `demo/STRESS_TEST_FINDINGS.md` maps to a task — Finding 2 → Task 1; Finding 3 → Task 2; Finding 3b → Task 3. Finding 1 (`super.method()`) is explicitly OUT of scope (separate family, demo #36 Finding A) and Task 4 Step 1 says to leave its workaround. ✓

**2. Placeholder scan:** Every code step contains real code; every command has expected output. The two "read to confirm" steps (Task 1 Step 3, Task 3 Step 3) name exact line ranges and what to confirm. The Task 2 Step 4 note about adding `namespaceNames` to `StatementRenderer` if absent gives the exact mirror site (expression-renderer.ts:129). ✓

**3. Consistency:** The `staticPrefix` string (`"static inline "`) is identical across all three field loops in Task 1. The regex in Task 2 Step 4 (`/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/`) matches the same identifier grammar the rest of the codebase uses. `ns.constants` / `ns.children` in Task 3 match the `NamespaceIR` shape from namespace-builder.ts:200-202. Test helper names (`transpileArduino`) match `tests/setup.ts`. ✓

**4. Order:** Fix 1 → Fix 2 → Fix 3 → integration. Task 2's test (`Devices.total`) and Task 1's test (`Devices.Registry.count`) both exercise namespace member access, so Fix 2 (`::` on targets) is needed for Fix 1's test to fully pass — but each task's test is written to pass after ITS OWN fix (Task 1's test asserts the `static inline` field render, which Fix 1 alone delivers; the `Registry.count` access in that test is a method body that Fix 2 covers, but the test's primary assertion is the field declaration). If Task 1's test fails on the access rather than the declaration, reorder to do Task 2 first. ✓
