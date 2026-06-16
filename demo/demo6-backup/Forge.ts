// ---------------------------------------------------------------------------
// Forge.ts — the orchestrator: owns stations + stockpile, runs the tick loop,
// aggregates stats, and produces the end-of-run report.
//
// SUPPORT_MATRIX tour:
//   §4.1  class with fields (arrays of class-instance pointers)
//   §4.3  getter, instance method
//   §4.5  class-instance arrays → std::vector<Station*>; item->field access
//   §1.5  for...of over class array (item->method())
//   §2.2  do...while main loop; for...of
//   §2.4  switch over enum/int discriminator
//   §2.5  try/catch on native target (✅)
//   §5.2  Math.floor, Math.min
//   §3.4  function-as-argument (std::function)
//   §6.2  multi-file imports
// ---------------------------------------------------------------------------

import { Stockpile } from './Stockpile';
import { Workstation, Smelter, Assembler, pickRecipe } from './Workstation';
import { buildRecipes, sumIds } from './Recipes';
import {
  Material,
  Recipe,
  RunStats,
  STARTER_COAL,
  STARTER_ORE,
  TICKS_PER_RUN,
  materialName,
} from './Types';

export class Forge {
  // §4.5 — array of class-instance pointers. Each element is a Workstation*.
  private stations: Workstation[];
  // §4.1 — instance field of class type (Stockpile* under the hood).
  private storage: Stockpile;
  // The recipe catalog, built once at construction.
  private recipes: Recipe[];
  // Stats accumulators.
  private craftsCompleted: int16_t = 0;
  private craftsAttempted: int16_t = 0;

  constructor() {
    this.stations = [];
    // §4.5 — `new Smelter()` returns a Smelter* (reference semantics).
    // The base-typed array stores Workstation*.
    this.stations.push(new Smelter());
    this.stations.push(new Smelter());
    this.stations.push(new Assembler());
    this.stations.push(new Assembler());
    this.storage = Stockpile.empty();
    this.recipes = buildRecipes();
    // Seed the starting stockpile.
    this.storage.deposit(Material.Ore, STARTER_ORE);
    this.storage.deposit(Material.Coal, STARTER_COAL);
  }

  // §4.3 — getter: number of stations.
  public get stationCount(): int16_t {
    return this.stations.length;
  }

  // §4.3 — getter: current ore reserve (delegating read).
  public get oreReserve(): int16_t {
    return this.storage.amountOf(Material.Ore);
  }

  // Snapshot the stockpile for reporting.
  public stockSummary(): string {
    return Stockpile.format(this.storage);
  }

  // Run the simulation. §2.2 — do...while main loop.
  public run(): void {
    let tick: int16_t = 0;
    do {
      // §1.5 — for...of over a class-instance array; `station` is a pointer,
      // so `station->method()` is emitted (§4.5 deep-access chain).
      for (const station of this.stations) {
        const recipe = pickRecipe(station, this.recipes, this.storage);
        this.craftsAttempted += 1;
        // §2.4 — switch over the recipe id to pick a per-recipe accounting
        // path. This exercises enum/int discriminant switching.
        switch (recipe.id) {
          case 1: {
            // Smelting — track as primary production.
            const ok = station.tick(recipe, this.storage);
            if (ok) {
              this.craftsCompleted += 1;
            }
            break;
          }
          case 2:
          case 3: {
            // Plate / Gear — light assembly.
            const ok = station.tick(recipe, this.storage);
            if (ok) {
              this.craftsCompleted += 1;
            }
            break;
          }
          default: {
            // Circuit / Alloy — heavy assembly. Wrap in try/catch on native
            // targets (§2.5 — ✅ on native). The body never throws here, but
            // the construct is exercised for completeness.
            try {
              const ok = station.tick(recipe, this.storage);
              if (ok) {
                this.craftsCompleted += 1;
              }
            } catch (e) {
              // Swallow; the craft just doesn't count.
            }
            break;
          }
        }
      }
      tick += 1;
    } while (tick < TICKS_PER_RUN);
  }

  // §4.3 — summarize the run into a value struct (§1.6 → returned by value).
  public summarize(): RunStats {
    let energy: int16_t = 0;
    // §1.5/§4.5 — accumulate energy across all stations via pointer access.
    // NOTE: we use the explicit `energyValue()` method rather than the
    // `energy` getter. The getter rewrite to `getEnergy()` works for
    // `this.energy` and for identifier receivers whose type is registered, but
    // the for-of loop variable's type isn't resolved at the header-inlined
    // method site in this build (see README issue C note — the fix is
    // implemented and unit-tested but the demo's cross-file class layout needs
    // additional type-resolution work to benefit from it here).
    for (const s of this.stations) {
      energy += s.energyValue();
    }
    return {
      ticksRun: TICKS_PER_RUN,
      craftsCompleted: this.craftsCompleted,
      craftsAttempted: this.craftsAttempted,
      energyConsumed: energy,
      materialsConsumed: this.materialsConsumedSoFar(),
    };
  }

  // Compute total materials consumed = (starter stock) − (current stock),
  // summed over the consumed inputs.
  private materialsConsumedSoFar(): int16_t {
    const oreUsed = STARTER_ORE - this.storage.amountOf(Material.Ore);
    const coalUsed = STARTER_COAL - this.storage.amountOf(Material.Coal);
    return oreUsed + coalUsed;
  }

  // §3.4 — pass a function as an argument. `formatter` is called with the
  // computed checksum to demonstrate higher-order function lowering
  // (std::function<int16_t(int16_t)>).
  public report(formatter: (checksum: int16_t) => int16_t): RunStats {
    // §5.1 — assemble a recipe-id checksum. Pass the vector directly (the
    // literal-args rest-param call case needs a signature table — see README
    // issue E note; the spread-of-vector case is fixed but this call uses a
    // plain array param to cover both uniformly).
    const recipeIds: int16_t[] = [1, 2, 3, 4, 5];
    const checksum = sumIds(recipeIds);
    // Invoke the formatter (higher-order call).
    const tagged = formatter(checksum);

    const stats = this.summarize();
    // §5.2 — Math.floor for rounding; Math.min to clamp a ratio.
    const successRate = stats.craftsAttempted > 0
      ? Math.floor((stats.craftsCompleted * 100) / stats.craftsAttempted)
      : 0;
    const perTick = Math.min(
      stats.craftsCompleted,
      TICKS_PER_RUN * this.stationCount,
    );

    // §1.4 — string concatenation for the report. §4.3 — getter access
    // (`this.stationCount` is a getter on `this`, which lowers correctly
    // because the receiver is `this`, not a pointer-dereferenced loop var).
    console.log('=== FORGE sim complete ===');
    console.log('ticks=' + stats.ticksRun + ' stations=' + this.stationCount);
    console.log(
      'crafts_completed=' +
        stats.craftsCompleted +
        ' attempted=' +
        stats.craftsAttempted +
        ' success_rate=' +
        successRate +
        '%',
    );
    console.log(
      'energy_consumed=' +
        stats.energyConsumed +
        ' materials_consumed=' +
        stats.materialsConsumed,
    );
    console.log('checksum=' + tagged + ' per_tick_cap=' + perTick);
    console.log('stock=' + this.stockSummary());
    // §1.7 — enum dispatch via materialName over the depletion catalog.
    let depletionLine = 'depletions=';
    let anyDepleted = false;
    const depletionCatalog: Material[] = [Material.Ore, Material.Coal];
    for (const m of depletionCatalog) {
      if (this.storage.hasBeenDepleted(m)) {
        depletionLine = depletionLine + materialName(m) + ' ';
        anyDepleted = true;
      }
    }
    if (!anyDepleted) {
      depletionLine = depletionLine + 'none';
    }
    console.log(depletionLine);
    return stats;
  }
}
