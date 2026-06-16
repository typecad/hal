// ---------------------------------------------------------------------------
// main.ts — Ledger numeric-utilities driver.
//
// SUPPORT_MATRIX tour for Demo #10 (untested slice):
//   §5.3  shift/unshift/reverse/fill/concat
//   §3.5  forEach as a statement
//   §1.7  Partial/Pick/Omit/NonNullable
//   §1.10 typeof, <T>x angle-bracket assertion
//   §1.3  int promoted to double
//   §1.4  nested template literals
//   §2.4  switch without default
//   §6.1  top-level statements → main()
// ---------------------------------------------------------------------------

import {
  shiftFirst,
  prependCount,
  reverseCopy,
  fillNew,
  concatAll,
  forEachSum,
  typeName,
  castToInt,
  average,
  banner,
  classify,
  EntryPatch,
} from './models/NumericUtils';

// §1.1 — uninitialized typed local (`let x: number` with no initializer, then
// assigned). Avoided `var` (gated out by lint).
let acc: int32_t;
acc = 0;

// §5.3 — shift/unshift/reverse/fill/concat.
const xs: int32_t[] = [1, 2, 3];
const shifted = shiftFirst(xs);
console.log(`shifted=${shifted}`);

const grew = prependCount([5, 6, 7], 4);
console.log(`prepended=${grew}`);

const rev = reverseCopy([1, 2, 3]);
console.log(`rev_0=${rev[0]}`);

const filled = fillNew(3, 9);
console.log(`filled_0=${filled[0]}`);

const cat = concatAll([1, 2], [3, 4]);
console.log(`concat_len=${cat.length}`);

// §3.5 — forEach as a statement.
const sum = forEachSum([10, 20, 30]);
console.log(`forEach_sum=${sum}`);

// §1.10 — typeof (Finding C fixed — now returns "number" for int32_t) +
// angle-bracket assertion.
console.log(`typeof=${typeName(42)}`);
console.log(`cast=${castToInt(3.9)}`);

// §1.3 — int promoted to double.
console.log(`average=${average(3, 5)}`);

// §1.4 — nested template literals.
console.log(banner('ledger', 7));

// §2.4 — switch without default.
console.log(`classify_a=${classify('a')}`);

// §1.7 — utility types. NOTE: Partial<T>/Pick<T,K> resolve to the FULL
// underlying struct T (C++ structs have fixed shape). The aliases exist (emit
// `using X = Entry;`) and are usable as type annotations, but a value must
// provide all of T's fields (Finding B).
// §1.7 — utility types. The alias `EntryPatch = Partial<Entry>` emits as
// `using EntryPatch = Entry;` (survives tree-shaking — fix A). NOTE: multi-
// field struct value semantics have a pre-existing layout gap; we only verify
// the alias emits and is usable as a type annotation.
const patch: EntryPatch = { id: 0, value: 0, label: '' };
patch.id = 7;
console.log(`patch_id=${patch.id}`);

console.log(`done: shifted=${shifted} concat=${cat.length} acc=${acc}`);
