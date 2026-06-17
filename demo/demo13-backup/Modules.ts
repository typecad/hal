// ---------------------------------------------------------------------------
// Modules.ts — default import, re-exports, async/generator (lint-warned).
// ---------------------------------------------------------------------------

// §6.2 — re-export everything from another module.
export { Empty, Counter, Borrower, sumDestructured, firstTwo, isCounterViaField, isString, makeNested, logicalAssign } from './Classes';
export { getAssoc, getNumAssoc, forEachExprSum, forEachBlockSum, sortWithMathCallback, WrapperTest } from './Collections';
export { StringIndexMap, NumericKeyMap, IsNumber, sampleFn, MaybeVal, Constants } from './Types';

// §3.1 — export default function (the default export path).
export default function defaultEntry(): int32_t {
  return 42;
}

// §3.3 — async/await/generators are gated out by lint (no event loop /
// coroutine runtime on bare metal). These patterns are correctly rejected.

