// ---------------------------------------------------------------------------
// main.ts — KitchenSink driver: exercises ALL remaining untested features.
//
// NOTE: re-exports (`export { ... } from`) through Modules.ts don't resolve
// in the transpiler (the re-exported symbols aren't visible to the importer).
// Import directly from the source modules instead. The Modules.ts file still
// exists to document the re-export gap.
// ---------------------------------------------------------------------------

import { Counter, Empty, Borrower, sumDestructured, firstTwo, isCounterViaField, isString, makeNested, logicalAssign, PairAB, KindObj, FlagVal } from './models/Classes';
import { forEachExprSum, forEachBlockSum, sortWithMathCallback, WrapperTest } from './models/Collections';
import { sampleFn, Constants } from './models/Types';

// §1.6 — associative access via Map (tested in #5/#6/#7; Map.get() in a
// function return resolves to `auto` — a known gap).
const sim: Map<string, int32_t> = new Map();
sim.set('alpha', 10);
console.log(`assoc_alpha=${sim.get('alpha')}`);

// §4.1 — empty class.
const e = new Empty();
console.log(`empty_created`);

// §4.1 — static initializer block.
console.log(`counter_init=${Counter.count}`);

// §3.1 — nested class inside function.
console.log(`nested=${makeNested()}`);

// §3.2 — object destructure param (named interface for the call site).
const pair: PairAB = { a: 0, b: 0 };
pair.a = 3;
pair.b = 4;
console.log(`destructured=${sumDestructured(pair)}`);

// §3.2 — array destructure param.
console.log(`first_two=${firstTwo([10, 20])}`);

// §1.10 — typeof type guard (simplified — union narrowing gated).
console.log(`isstring_num=${isString(42)}`);

// §5.1 — ||= and &&= (named interface for the param).
const fv: FlagVal = { flag: false, val: 0 };
fv.flag = false;
fv.val = 5;
console.log(`logical_assign=${logicalAssign(fv)}`);

// §3.5 — forEach variants.
console.log(`forEach_expr=${forEachExprSum([1, 2, 3])}`);
console.log(`forEach_block=${forEachBlockSum([1, 2, 3])}`);

// §3.4 — Math.method callback via sort.
const sorted = sortWithMathCallback([3, 1, 2]);
console.log(`sorted_0=${sorted[0]}`);

// §4.6 — borrowed constructor param.
const borrower = new Borrower(99);
console.log(`borrowed=${borrower.getRef()}`);

// §4.6 — wrapper detection.
const wt = new WrapperTest();
console.log(`wrapper_created`);

// §1.7 — ReturnType/Parameters (type-only; sampleFn used to anchor).
console.log(`sample=${sampleFn(2, 3)}`);

// §1.7 — Constants (enum-inside-class substitute).
console.log(`mode_a=${Constants.MODE_A}`);

console.log(`done`);
