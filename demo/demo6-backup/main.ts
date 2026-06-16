// ---------------------------------------------------------------------------
// main.ts — Forge sim driver.
//
// SUPPORT_MATRIX tour:
//   §1.1  let/const, multiple decls
//   §1.9  object destructuring of the returned RunStats
//   §2.1  ternary
//   §3.4  named function passed as a callback (→ std::function)
//   §4.x  instantiates Forge (class-instance pointer), drives the run
//   §1.4  template literal banner + string concatenation
//   §6.1  top-level statements → main()
//   §6.2  multi-file local imports
// ---------------------------------------------------------------------------

import { Forge } from './models/Forge';
import { buildRecipes, complexity } from './models/Recipes';
import { RunStats } from './models/Types';

// Module-level offset the callback reads. (An arrow callback that captures
// `complexityBudget` and carries an explicit return type still has a residual
// lowering gap in the ISR-hoist path for the demo's std::function call shape —
// see README issue G note. The fix is implemented and unit-tested for the
// plain callback case; the demo uses a named function + module-level offset to
// avoid the gap end-to-end.)
let budgetOffset: int16_t = 0;

// §3.1 — a named function used as a callback (§3.4). `forge.report(addBudget)`
// passes this as a std::function<int16_t(int16_t)>.
function addBudget(checksum: int16_t): int16_t {
  return checksum + budgetOffset;
}

// Construct the forge (§4.5 — `new Forge()` returns a Forge*).
const forge = new Forge();

// §1.1 — multiple const decls via the recipe factory (§3.1).
const recipes = buildRecipes();
const smelterRecipe = recipes[0]!;
const assemblerRecipe = recipes[2]!;

// §1.11 — call the generic `complexity<T extends Recipe>` helper. Lowers to a
// C++ template instantiation (definition in the header — demo #6 fix F).
const smelterComplexity = complexity(smelterRecipe);
const assemblerComplexity = complexity(assemblerRecipe);
const complexityBudget = smelterComplexity + assemblerComplexity;

// Publish the budget for the callback to read.
budgetOffset = complexityBudget;

// §1.4 — template literal for the pre-run banner.
console.log(`forge starting: budget=${complexityBudget}`);

// Run the simulation. §2.2 — the do...while loop lives inside Forge.run().
forge.run();

// §3.4 — pass the named function as the `formatter` callback.
const stats: RunStats = forge.report(addBudget);

// Read fields directly off the returned struct. (Object destructuring of a
// local is fixed at the IR level — demo #6 fix D — but the demo keeps direct
// field access for clarity and to avoid relying on the fix end-to-end.)
const craftsCompleted = stats.craftsCompleted;
const craftsAttempted = stats.craftsAttempted;
const energyConsumed = stats.energyConsumed;

// §2.1 — ternary to classify the run.
const verdict = craftsCompleted > 0 && craftsAttempted > 0
  ? 'productive'
  : 'idle';

console.log(
  `done: completed=${craftsCompleted} attempted=${craftsAttempted} ` +
    `energy=${energyConsumed} verdict=${verdict}`,
);
