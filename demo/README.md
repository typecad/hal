# Bank Ledger — cuttlefish demo #18

A **simple, idiomatic TypeScript** program: a small in-memory `Bank` that keeps
`Account` structs in an array and supports opening accounts, depositing,
withdrawing (with overdraft refusal), totaling, and printing the ledger. The
driver opens two accounts, runs a few everyday transactions, and prints the
results. Transpiled to C++ by cuttlefish (`@typecad/framework-native`).

This is the **eighteenth** demo iteration. Like #15–#17 it is deliberately
**small and readable** — real, everyday TypeScript — and is **not** a
feature-exhaustion test. It is a single self-contained `main.ts`. It surfaced
**three** transpilation gaps, all now **fixed in the transpiler** and pinned by
`tests/packages/transpiler/demo-18-regressions.test.ts`.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

- **`npm run lint` exits 0** with no warnings.
- **`npm run compile` exits 0** with no diagnostics.
- When `g++` *does* emit errors they are surfaced verbatim and mapped back to
  TypeScript source spans (see the "raw g++ errors" excerpts in *Findings*).
- The binary runs with correct output.

## Sample output

```
overdraft_refused=false
alice=32.00
bob=125.00
total=157.00
---
#1 Alice (checking) 32.00
#2 Bob (savings) 125.00
done
```

Verified by hand: Alice (checking) gets +5000 −1800 = 3200¢ = $32.00; Bob
(savings) gets +12000 +500 = 12500¢ = $125.00; Bob's $9,999.99 withdrawal is
refused (`overdraft_refused=false`); total = 15700¢ = $157.00.

## What the source exercises

Idiomatic patterns that lower cleanly:

- §1.2  fixed-width ints (`int32_t`) and `boolean` → `bool`
- §1.4  template literals (`${...}`) → `snprintf` — incl. **struct-field**
        interpolation inside a class method (Finding C, now fixed)
- §1.6  `interface Account` → C++ `struct`; object-literal construction
- §1.7  `const enum Kind` (inlined); numeric `switch` / `default`
- §1.8  `find(): Account | null` + `a === null` (Finding A, now fixed)
- §3.1  module-scope free functions (`formatMoney`/`kindLabel`)
- §4.1  `class Bank` with private fields + field initializers
- §4.2  `this.field` read/write; `this->` lowering; `new Bank()` → pointer
- §4.3  instance methods; **a class method calling module-scope free
        functions** (Finding B, now fixed)
- §5.1  comparison `===`/`<`; relational; compound arithmetic; indexed access
- §5.3  `Array.push` (promotes backing storage); `.length` on array
- §2.2  classic C-style `for (let i; i < arr.length; i = i + 1)`; indexed
        array mutation (`this.accounts[i].cents = ...`) writes through to the
        vector element

---

# Transpilation issues found by Demo #18 — all RESOLVED

Demo #18 is plain everyday TypeScript. It surfaced **three** transpiler gaps,
each now **fixed** and pinned by a regression test. The demo source uses the
natural idiomatic form for all three.

## Fix A — a struct returned from a function/method and compared with `=== null`

| Finding | Fix | File(s) |
|---|---|---|
| A private helper `find(): Account \| null` returning `null` when not found, with callers `if (a === null)`. The generated C++ lowered `a === null` to `a == CUTTLEFISH_UNDEFINED` (`== 0`), but `Account` is a struct with no `operator==(int)` → g++ `no match for 'operator==' (operand types are 'Account' and 'int')`. | The value-type null-comparison guard (`expressionToIR`) recognized *class* names (always pointer types) as value types, but never *interface* names — which lower to value-typed `struct`s. A `topLevelInterfaceNames` set is now populated in a pre-pass (`build-ir.ts`) and the guard recognizes it, so `struct === null` resolves to a compile-time `false`. Inline-call forms (`find(id) === null`, `this.find(id) === null`) are resolved too via the callee's declared return type (`resolveCallReturnTypeForNullGuard`). | `ir/build-ir-state.ts`, `ir/build-ir.ts`, `ir/expression-to-ir.ts` |

Raw g++ error that motivated the fix (before):

```
main.h: In member function 'bool Bank::deposit(int32_t, int32_t)':
main.h:XX:XX: error: no match for 'operator==' (operand types are 'Account' and 'int')
   XX |     if (a == CUTTLEFISH_UNDEFINED)
```

After: `if (a === null)` lowers to `if (false)` — a value type is never null.

## Fix B — a module-scope free function called from a class method body (split mode)

| Finding | Fix | File(s) |
|---|---|---|
| A module-scope free function (`formatMoney`/`kindLabel`) called from inside a `Bank` method body. In split mode the class method body is emitted **inline in the header**, but the free function's only forward declaration was `static` in the `.cpp`, written *after* `#include "main.h"` → g++ `'formatMoney' was not declared in this scope`. | `setup.ts` now walks class method/getter/setter/constructor IR to find free-function call sites. A free function called from a class body is emitted with a **non-static forward declaration in the header** (in `emitFunctionForwardDeclarations`, which precedes class emission) and a **non-static definition** in the .cpp (a `static` definition would clash with the header's extern prototype). A free function *not* called from any class body stays `static`. | `emit/emitters/setup.ts`, `emit/emitters/function-emitter-impl.ts`, `emit/emitters/emitter-context.ts` |

Before: header had no prototype; method body → `'fn' was not declared in this scope`.
After: header carries `std::string formatMoney(int32_t cents);` ahead of the class.

## Fix C — struct-field interpolation in a class-method template literal (silent runtime corruption)

| Finding | Fix | File(s) |
|---|---|---|
| Interpolating struct fields (`${a.id}`, `${a.name}`) in a template literal inside a class method compiled cleanly but printed **garbage** (`%lld` for every field, no `.c_str()` for the `std::string` field). Root cause: emitting a named-typed object literal (`const a: Account = {...}`) **clobbered** the interface's authoritative `interfaceFieldTypes` entry (registered from the declaration) with types inferred from the initializer *values* — which, after the native strategy's `normalizeCppType` (`int`→`long long`), collapsed every field to `long long`, so the snprintf format inference picked `%lld` for everything. | The object-literal emitter no longer overwrites an existing declared field-type entry; it only seeds the map for anonymous struct types that have no declared entry. Field-type inference now consistently sees the declared types (`int32_t`, `std::string`, enum). | `emit/statement-renderer.ts` |

Before: `snprintf(buf, n, "#%lld %lld (%s) %s", a.id, a.name, ...);` (silent — compiles, corrupts output).
After:  `snprintf(buf, n, "#%d %s (%s) %s", a.id, a.name.c_str(), ...);` — correct.

This was the most dangerous of the three: it type-checked and compiled with no
diagnostic, corrupting output only at runtime.

## Notes

- The `deposit`/`withdraw` methods mutate the account **by index**
  (`this.accounts[i].cents = ...`) rather than via the `find()` helper's
  return. This is not a workaround for a bug — it reflects a deliberate,
  documented design choice: a struct returned from a function is a C++ *value
  copy* (same value-semantics limitation as `Map.get()`, SUPPORT_MATRIX §1.5),
  so mutating it would not write back to the vector element. `find()` is kept
  for **read-only** lookups (`balanceOf`) where the copy is fine.

## Build verdict

- **`npm run lint` exits 0** (no warnings).
- **`npm run compile` exits 0** (no diagnostics). The binary runs with
  **all-correct output**, verified by hand.
- **Full transpiler suite: 1123 passed, 1 pre-existing unrelated failure
  (`null as any` fixture in `multi-file.test.ts`), 18 skipped.** The 8 new
  demo-18 tests pass; the previously-`.skip`ed free-function-forward-decl test
  in `multi-file.test.ts` is now enabled and passing.
