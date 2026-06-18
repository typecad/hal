# Library Book Tracker — cuttlefish demo #19

A **simple, idiomatic TypeScript** program: a tiny in-memory `Library` that keeps
`Book` structs in an array and supports adding books, checking them out,
returning them (both with refusal on the wrong state), and reporting how many
are currently available. The driver stocks a three-book library, lends a couple
out, returns one, and prints the final shelf. Transpiled to C++ by cuttlefish
(`@typecad/framework-native`).

This is the **nineteenth** demo iteration. Like #15–#18 it is deliberately
**small and readable** — real, everyday TypeScript — and is **not** a
feature-exhaustion test. It is a single self-contained `main.ts`.

The previous iteration (#18, bank ledger) is preserved in `demo18-backup/`.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

- **`npm run lint` exits 0** with no warnings.
- **`npm run compile` exits 0** with no diagnostics.
- When `g++` *does* emit errors they are surfaced verbatim and mapped back to
  TypeScript source spans (none on this demo — see *Findings*).
- The binary runs with correct output.

## Sample output

```
lent1=true
lent2=true
double_lend_refused=false
unknown_refused=false
returned=true
return_again_refused=false
available=2/3
---
#1 [on loan] The Pragmatic Programmer
#2 [available] Clean Code
#3 [available] The Mythical Man-Month
done
```

Verified by hand:

- 3 books stocked: #1 *The Pragmatic Programmer*, #2 *Clean Code*,
  #3 *The Mythical Man-Month* (all `Available`).
- `checkOut("Clean Code")` → #2 `OnLoan` → `true`.
- `checkOut("The Pragmatic Programmer")` → #1 `OnLoan` → `true`.
- `checkOut("Clean Code")` again → already on loan → `false`.
- `checkOut("Nonexistent")` → not found → `false`.
- `returnBook("Clean Code")` → #2 `Available` → `true`.
- `returnBook("Clean Code")` again → already available → `false`.
- `available = 2/3` (#2 and #3 are available; #1 is on loan).

## What the source exercises

Idiomatic patterns that lower cleanly:

- §1.2  fixed-width ints (`int32_t`) and `boolean` → `bool`
- §1.4  template literals (`${...}`) → `snprintf` — incl. **struct-field**
        interpolation *and* a **free-function call** (`statusLabel(b.status)`)
        interpolated inside a class method
- §1.6  `interface Book` → C++ `struct`; object-literal construction
- §1.7  `const enum Status` (inlined); enum **relational comparison** lowered
        via `static_cast<int>`; numeric `switch` / `default`
- §3.1  module-scope free function (`statusLabel`)
- §4.1  `class Library` with private fields + field initializers
- §4.2  `this.field` read/write; `this->` lowering; `new Library()` → pointer
- §4.3  instance methods; **a class method calling a module-scope free
        function** (re-exercises the demo #18 fix B)
- §5.1  comparison `===`/`<`; indexed access; compound arithmetic
- §5.3  `Array.push` (promotes backing storage); `.length` on array, widened
        from `size_t` to `long long` via `static_cast`
- §2.2  classic C-style `for (let i; i < arr.length; i = i + 1)`; indexed
        array mutation (`this.books[i].status = ...`) writes through to the
        vector element

---

# Transpilation issues found by Demo #19

**None.** Demo #19 is plain everyday TypeScript and it transpiled, compiled,
and ran correctly **on the first attempt** — `npm run lint` and
`npm run compile` both exit 0 with no diagnostics, and the binary's output
matches the hand-computed expected values exactly.

This is a meaningful result on its own: the demo was written fresh against a
domain (a lending library) and a slightly different mix of idioms than the
preceding iterations (notably a **string-keyed linear search** and **enum
status comparisons**), and it surfaced **no new transpiler gaps**. It therefore
acts as a clean regression check that the fixes pinned by demos #14–#18
continue to hold under a new idiomatic program:

- The **free-function-forward-declaration-in-header** lowering from demo #18
  fix B (`statusLabel` is called from `Library::printAll` and emits a
  non-static prototype in `main.h` ahead of the class).
- The **struct-field template-literal interpolation** from demo #18 fix C
  (`#${b.id} [${statusLabel(b.status)}] ${b.title}` infers `%d`/`%s` and
  emits `.c_str()` for the `std::string` operands).
- **Enum relational comparison** (`b.status === Status.Available`) lowers
  through `static_cast<int>` rather than a raw `==` on the scoped enum.
- **`.length` / `.size()` widening** to `long long` via `static_cast`, so
  the `i < this->books.size()` loop comparison is type-consistent.

## Notes

- As in demo #18, the mutating methods (`checkOut`/`returnBook`) look a book
  up **by index** and write through `this.books[i].status = ...`, rather than
  via a helper that returns the `Book`. This is the documented value-semantics
  design choice (a struct returned from a function is a C++ *value copy*,
  SUPPORT_MATRIX §1.5); the read-only `indexOf` helper is kept for lookup.
- The `for...of` loops over `this.books` are read-only, so the loop variable
  correctly lowers to `const Book& b` (a const reference).

## Build verdict

- **`npm run lint` exits 0** (no warnings).
- **`npm run compile` exits 0** (no diagnostics). The binary runs with
  **all-correct output**, verified by hand.
- **No new transpiler fixes or regression tests were required** for this demo.
