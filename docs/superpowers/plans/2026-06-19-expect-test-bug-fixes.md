# Expect-test bug fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs surfaced during expect testing (destructuring-assignment swap silently dropped; anonymous-object shadow struct not emitted on AVR) and document a third (`number[][]` on AVR) as a known limitation.

**Architecture:** Two surgical fixes and one doc update. The swap fix adds an `ArrayLiteralExpression`-LHS case to `expressionStatementToIR`. The shadow-struct fix ensures the struct definition is emitted when the StaticArray promotion path references a shadow type. The `number[][]` case is documented as AVR-🚫 (recursive StaticArray promotion for nested arrays is a larger feature with questionable ROI on a 2KB-RAM target).

**Tech Stack:** TypeScript, vitest, cuttlefish IR/emit pipeline. Tests use `transpile`/`transpileArduino` from `tests/setup.ts`; hardware tests use `@typecad/expect`.

**Source findings:** `demo/STRESS_TEST_FINDINGS.md` (destructuring section), expect-test commit `509b34d`.

---

## File Structure

**Modify:**
- `packages/cuttlefish/src/ir/transformers/expressions.ts` — add array-literal-LHS assignment handling (swap fix).
- `packages/cuttlefish/src/ir/transformers/variables.ts` — ensure shadow-struct definition is emitted when StaticArray promotion uses it (shadow-struct fix).
- `packages/framework-arduino/tests/36-destructuring.test.ts` — restore the swap test case after the fix.
- `SUPPORT_MATRIX.md` — document `number[][]` as AVR-🚫.

**Test (create/modify):**
- `tests/packages/transpiler/destructuring-regressions.test.ts` — add swap + shadow-struct regression tests.

---

## Task 1: Fix — destructuring assignment (swap) is silently dropped

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/expressions.ts:42` (add a case before `return undefined`)
- Test: `tests/packages/transpiler/destructuring-regressions.test.ts` (append)

- [ ] **Step 1: Append the failing swap test**

Append to `tests/packages/transpiler/destructuring-regressions.test.ts`:

```ts
// ── Bug: swap via destructuring assignment is silently dropped ──────────────
// [a, b] = [b, a] produced NO output — the expression statement handler
// (expressions.ts) had no case for an ArrayLiteralExpression LHS, so it
// fell through to `return undefined`. The assignment was dropped entirely.
describe("swap via destructuring assignment", () => {
  it("swaps two variables", () => {
    const src = `
function f(): number {
  let a: number = 1;
  let b: number = 2;
  [a, b] = [b, a];
  return a * 10 + b;
}
`;
    const res = transpile(src, { target: "native" });
    // Must emit a swap (not silently drop it). The emitted code must use
    // temporaries so the swap is correct (a=2, b=1 → 21, not 12).
    expect(res.cpp).toMatch(/= 2/);   // a gets 2
    expect(res.cpp).toMatch(/= 1/);   // b gets 1
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/packages/transpiler/destructuring-regressions.test.ts -t "swap"`
Expected: FAIL — the emitted code has no swap (both `= 2` and `= 1` assertions fail).

- [ ] **Step 3: Read the expression statement handler to confirm the edit site**

Read `packages/cuttlefish/src/ir/transformers/expressions.ts` lines 42-388. Confirm: the function handles `BinaryExpression` with LHS being `PropertyAccessExpression` (line 50), `ElementAccessExpression` (line 136), and `Identifier` (line 154) — but has NO case for `ArrayLiteralExpression` LHS. At line 388, `return undefined` is the fallthrough that drops the swap.

- [ ] **Step 4: Add the array-literal-LHS assignment case**

In `packages/cuttlefish/src/ir/transformers/expressions.ts`, add a new case BEFORE the final `return undefined` (line 388), after the last `PostfixUnaryExpression` block. Insert:

```ts
  // Destructuring assignment: `[a, b] = expr` (reassignment to existing
  // variables, NOT a const/let declaration). Without this, `[a, b] = [b, a]`
  // fell through to `return undefined` and was silently dropped. Lower to
  // individual assignments, evaluating the RHS array elements to temporaries
  // FIRST so a swap is correct (old values captured before any assignment).
  if (ts.isBinaryExpression(expr)
      && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isArrayLiteralExpression(expr.left)) {
    const targets = expr.left.elements.filter(ts.isIdentifier);
    const rhs = expr.right;
    // If the RHS is an array literal, evaluate each element to a temporary
    // variable, then assign. If RHS is a variable/expression, index into it.
    const stmts: StatementIR[] = [];
    const span = makeSourceSpan(statement, fileName, sourceText);
    const comments = extractNodeComments(statement, sourceText);
    if (ts.isArrayLiteralExpression(rhs)) {
      // `[a, b] = [b, a]` → temp_0 = b; temp_1 = a; a = temp_0; b = temp_1;
      const temps: string[] = [];
      for (let i = 0; i < targets.length; i++) {
        const tempName = `__swap_${i}`;
        temps.push(tempName);
        stmts.push({
          kind: "var_decl",
          sourceSpan: span,
          name: tempName,
          storage: "const",
          cppType: "auto",
          initializer: expressionToIR(rhs.elements[i], sourceText, diagnostics, pointerVars),
        });
      }
      for (let i = 0; i < targets.length; i++) {
        stmts.push({
          kind: "assign",
          sourceSpan: span,
          target: targets[i].text,
          operator: "=",
          value: { kind: "identifier", value: temps[i] },
        });
      }
    } else {
      // `[a, b] = arr` → a = arr[0]; b = arr[1]; (index-based)
      const rhsText = renderExprAsText(expressionToIR(rhs, sourceText, diagnostics, pointerVars));
      for (let i = 0; i < targets.length; i++) {
        stmts.push({
          kind: "assign",
          sourceSpan: span,
          target: targets[i].text,
          operator: "=",
          value: { kind: "element-access", object: { kind: "identifier", value: rhsText }, index: { kind: "number", value: String(i) } },
        });
      }
    }
    if (stmts.length > 0) {
      return {
        kind: "block",
        sourceSpan: span,
        leadingComments: comments.leadingComments,
        trailingComments: comments.trailingComments,
        body: stmts,
      };
    }
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/packages/transpiler/destructuring-regressions.test.ts -t "swap"`
Expected: PASS.

- [ ] **Step 6: Run the full transpiler suite for regressions**

Run: `npx vitest run tests/packages/transpiler/ tests/statements.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/expressions.ts tests/packages/transpiler/destructuring-regressions.test.ts
git commit -m "fix(ir): destructuring assignment (swap) not silently dropped"
```

---

## Task 2: Fix — anonymous-object shadow struct not emitted on AVR StaticArray path

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/variables.ts` (shadow-struct definition emission)
- Test: `tests/packages/transpiler/destructuring-regressions.test.ts` (append)

- [ ] **Step 1: Append the failing shadow-struct test**

Append to `tests/packages/transpiler/destructuring-regressions.test.ts`:

```ts
// ── Bug: anonymous-object shadow struct (_name_t) not emitted on AVR ───────
// A `const pts: { x: number; y: number }[] = [...]` on AVR lowers to
// __tc_StaticArray<_pts_t,N> but never emits `struct _pts_t { ... }`,
// so avr-g++ fails ("_pts_t does not name a type"). Named interfaces work.
describe("anonymous-object shadow struct on AVR", () => {
  it("emits the shadow struct definition when promoted to StaticArray", () => {
    const src = `
function f(): number {
  const pts: { x: number; y: number }[] = [{ x: 2, y: 3 }, { x: 4, y: 5 }];
  return pts[0].x;
}
`;
    const res = transpileArduino(src);
    // The shadow struct MUST be defined, not just referenced.
    expect(res.cpp).toMatch(/struct\s+_pts_t\s*\{/);
    const errs = res.diagnostics.filter(d => d.severity === "error");
    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/packages/transpiler/destructuring-regressions.test.ts -t "shadow struct"`
Expected: FAIL — `struct _pts_t {` is not in the emitted cpp.

- [ ] **Step 3: Read how the NON-StaticArray path emits the shadow struct definition**

Read `packages/cuttlefish/src/emit/emitters/function-emitter-impl.ts` lines 40-100. This code walks `ctx.emittedTopLevelStatements` and, for a `var_decl` with an `object` initializer, emits the shadow struct definition (`struct _name_t { ... };`). The StaticArray promotion path (variables.ts ~line 750-770) replaces the original `var_decl` (which had the `object`/`array` initializer) with a `var_decl` that has `initializer: undefined` + a series of `.push()` calls — so the emit-side struct definition emission (which looks for `initializer.kind === "object"`) never fires.

The fix: when the StaticArray promotion path detects a shadow-struct element type (anonymous object), it must ensure the struct definition is registered for emission. The cleanest way: the promotion already generates push calls with object-literal arguments (`pts.push({ 2, 3 })`); the shadow struct definition must be emitted alongside.

- [ ] **Step 4: Ensure the shadow struct is emitted on the StaticArray path**

In `packages/cuttlefish/src/ir/transformers/variables.ts`, within the StaticArray promotion block (around line 750-770, the `shouldPromote` branch), when the element type is a shadow struct (`_name_t`), register the struct definition so the emitter outputs it. The existing non-promotion path emits the struct via the object-literal initializer; on the promotion path, add the struct fields to a collection the emit stage consults.

The minimal fix: the emitter's struct-definition walk (`function-emitter-impl.ts`) looks at `statement.initializer?.kind === "object"`. The StaticArray promotion path sets `initializer: undefined`. Instead, when the promotion uses a shadow struct, keep a side-channel reference to the original object literal so the emitter can still derive the struct definition.

In `variables.ts`, in the promotion block, when `isStructElement && !isNamedElementType` (i.e., a shadow struct), emit the shadow struct definition as a synthetic leading statement BEFORE the StaticArray var_decl. Use the same struct-definition emission pattern the non-promotion path uses — extract the fields from the first element of `actualInitializer.elements` (an object literal) and build a `raw` IR node with the struct text.

After reading the existing code, insert BEFORE the `lowered.push({ kind: "var_decl", ... })` in the promotion block:

```ts
          // When the element type is a shadow struct (anonymous object), the
          // struct definition must be emitted BEFORE the StaticArray uses it.
          // The non-promotion path emits it via the object-literal initializer;
          // the promotion path replaces that initializer, so emit the struct
          // definition as a synthetic raw statement here.
          if (isStructElement && /^_[A-Za-z0-9_]+_t$/.test(elemType)) {
            const firstElem = elements.find(
              (e): e is ts.Expression => !ts.isSpreadElement(e) && ts.isObjectLiteralExpression(e)
            );
            if (firstElem && ts.isObjectLiteralExpression(firstElem)) {
              const fieldDefs = firstElem.properties
                .filter(ts.isPropertyAssignment)
                .map((p) => {
                  const fname = ts.isIdentifier(p.name) ? p.name.text : p.name.getText();
                  const ftype = inferExprCppType(p.initializer, functionReturnTypes, localVariableTypes, sourceText);
                  return `${ftype || "auto"} ${fname};`;
                })
                .join("  ");
              lowered.push({
                kind: "raw_statement",
                sourceSpan: loweredDeclaration.sourceSpan,
                text: `struct ${elemType} { ${fieldDefs} };`,
              });
            }
          }
```

**IMPORTANT:** Check whether `raw_statement` is a valid StatementIR kind. If not, use `{ kind: "call", callee: "__EMIT__", args: [{ kind: "string", value: \`struct ${elemType} { ${fieldDefs} };\` }] }` — the same `__EMIT__` pattern used elsewhere for raw C++ injection. Read `ir-core.ts` to confirm the kind; use `__EMIT__` if `raw_statement` doesn't exist.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/packages/transpiler/destructuring-regressions.test.ts -t "shadow struct"`
Expected: PASS — `struct _pts_t {` appears in the emitted cpp.

- [ ] **Step 6: Run the full transpiler + array suites for regressions**

Run: `npx vitest run tests/packages/transpiler/ tests/bug-a-mutable-array-vars.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/variables.ts tests/packages/transpiler/destructuring-regressions.test.ts
git commit -m "fix(ir): emit shadow struct definition on AVR StaticArray path"
```

---

## Task 3: Document `number[][]` (nested arrays) as AVR-🚫 and restore expect test cases

**Files:**
- Modify: `SUPPORT_MATRIX.md` — add a row for nested arrays.
- Modify: `packages/framework-arduino/tests/36-destructuring.test.ts` — restore the swap case and the for...of array-element destructure (adapted).

- [ ] **Step 1: Document `number[][]` as AVR-🚫 in SUPPORT_MATRIX.md**

In `SUPPORT_MATRIX.md`, in the §1.5 Arrays table, add a row after the existing 2D-arrays row:

```markdown
| 2D arrays `T[][]` | ✅ on native/ESP32 · 🚫 on AVR | **AVR note**: On AVR a `T[][]` mis-resolves the inner element to a scalar and lowers to `std::vector<T>[]`, which has no valid C++ on a no-`<vector>` target. The StaticArray promotion does not recurse into nested arrays. Use parallel flat arrays (`xs[]`, `ys[]`) or a flat struct array on AVR. Native/ESP32 emit `std::vector<std::vector<T>>` correctly. |
```

- [ ] **Step 2: Restore the swap test case in 36-destructuring.test.ts**

In `packages/framework-arduino/tests/36-destructuring.test.ts`, replace the swap NOTE comment with the actual test (Task 1 fixed it):

```ts
  .it("swap via array destructuring")
  .expect(
    (() => {
      let a: number = 1;
      let b: number = 2;
      [a, b] = [b, a];
      return a * 10 + b;
    })
  ).toBe(21)
```

Do NOT restore the `number[][]` for...of array-element destructure (that's documented AVR-🚫).

- [ ] **Step 3: Rebuild dist and run the hardware expect test**

```bash
cd packages/cuttlefish && npm run build
cd ../framework-arduino && npm run test:hw -- tests/36-destructuring.test.ts
```

Expected: all tests pass on hardware (now 12 — the restored swap case).

- [ ] **Step 4: Commit**

```bash
git add SUPPORT_MATRIX.md packages/framework-arduino/tests/36-destructuring.test.ts
git commit -m "docs: number[][] AVR-🚫; restore swap expect test after fix"
```

---

## Self-Review

**1. Spec coverage:** Three bugs → three tasks. Swap (Task 1, FIX), shadow-struct (Task 2, FIX), `number[][]` (Task 3, document as AVR-🚫). No gaps.

**2. Placeholder scan:** Every step has real code. Task 2 Step 4 has a note about `raw_statement` vs `__EMIT__` — the implementer reads `ir-core.ts` to pick. The struct-field extraction reuses `inferExprCppType`. No "TBD"/"handle edge cases".

**3. Consistency:** The `elemType` variable name matches variables.ts usage. The `__EMIT__` fallback is the same pattern the codebase uses for raw C++ injection. The swap temporaries (`__swap_0`, `__swap_1`) match the naming convention used elsewhere (`__forof_N`, `__param_N`). Test helper names (`transpile`, `transpileArduino`) match `tests/setup.ts`. ✓
