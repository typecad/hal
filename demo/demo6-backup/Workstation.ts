// ---------------------------------------------------------------------------
// Workstation.ts — the station class hierarchy.
//
// SUPPORT_MATRIX tour:
//   §4.1  class with fields, initializers, static field
//   §4.2  constructor + super() call, this.x assignment, this.x += compound
//   §4.3  instance method, getter/setter pair, abstract method (pure virtual)
//   §4.4  class B extends A, super.method() (via base-name lowering)
//   §4.4  virtual method override (polymorphism) — produces() overridden
//   §4.5  class instances are pointers (new Smelter() returns Smelter*)
//   §1.7  enum used in method bodies and as field types
// ---------------------------------------------------------------------------

import { Stockpile } from './Stockpile';
import { Material, Recipe, StationKind, TICKS_PER_RUN } from './Types';

// §4.4 — abstract base class. The abstract method lowers to a pure virtual;
// the virtual destructor on the polymorphic base is emitted automatically
// (SUPPORT_MATRIX §4.4).
export abstract class Workstation {
  // §4.1 — public fields with initializers.
  public id: int16_t;
  public readonly kind: StationKind;
  // §4.1 — protected field.
  protected energyConsumed: int16_t = 0;
  // §4.1 — static field, shared across all instances.
  public static nextId: int16_t = 1;

  constructor(kind: StationKind) {
    // §4.1/§4.2 — static field access via class name.
    this.id = Workstation.nextId;
    Workstation.nextId = Workstation.nextId + 1;
    this.kind = kind;
  }

  // §4.3 — getter. Subclasses override `produces()` instead, but this base
  // getter is concrete and returns a sentinel. Demonstrates a non-overridden
  // getter on the base.
  public get label(): string {
    return 'station#' + this.id;
  }

  // §4.3 — getter for the energy meter.
  public get energy(): int16_t {
    return this.energyConsumed;
  }

  // §4.3 — setter for the energy meter (used by tests/reset paths).
  public set energy(value: int16_t) {
    this.energyConsumed = value;
  }

  // Explicit accessor backing the `energy` getter. Provided as a regular
  // method because getter access through a pointer in a for...of is not yet
  // rewritten to getEnergy() in the demo's cross-file class layout (see
  // Forge.ts note + README issue C).
  public energyValue(): int16_t {
    return this.energyConsumed;
  }

  // §4.4 — abstract method. Lowers to `virtual int16_t produces() const = 0;`.
  // Each subclass declares what material it outputs.
  public abstract produces(): Material;

  // The main per-tick action. Attempt one craft of `recipe` against `storage`,
  // paying its inputs and accruing its energy cost. Returns true if the craft
  // completed this tick (inputs were available); false otherwise. Subclasses
  // customize via `craft()`; this base orchestrates input payment.
  public tick(recipe: Recipe, storage: Stockpile): boolean {
    // §2.1 — guard: can we pay every input?
    let canPay = true;
    for (let i = 0; i < recipe.inputs.length; i++) {
      const need = recipe.counts[i]!;
      const have = storage.amountOf(recipe.inputs[i]!);
      if (have < need) {
        canPay = false;
      }
    }
    if (!canPay) {
      return false;
    }
    // Pay inputs.
    for (let i = 0; i < recipe.inputs.length; i++) {
      storage.withdraw(recipe.inputs[i]!, recipe.counts[i]!);
    }
    // Accrue energy. §4.2 — this.x compound assignment.
    this.energyConsumed += recipe.energy;
    // Defer the actual output+craft-time to the subclass.
    this.craft(recipe, storage);
    return true;
  }

  // §4.4 — a virtual method (not abstract) with a default no-op. Subclasses
  // override it. Demonstrates override-with-implementation polymorphism.
  protected craft(recipe: Recipe, storage: Stockpile): void {
    // Base default: emit the output directly.
    storage.deposit(recipe.output, 1);
  }
}

// §4.4 — Smelter specializes Workstation. Ore/Coal → Ingot.
export class Smelter extends Workstation {
  private smelts: int16_t = 0;

  constructor() {
    // §4.2 — super() call lowers to a C++ initializer list.
    super(StationKind.Smelter);
  }

  // §4.4 — override of the abstract produces().
  public override produces(): Material {
    return Material.Ingot;
  }

  // §4.4 — override of the virtual craft(). Smelters add a small bonus: when
  // the recipe uses a catalyst, an extra unit is produced (efficiency gain).
  protected override craft(recipe: Recipe, storage: Stockpile): void {
    let yieldUnits: int16_t = 1;
    if (recipe.hasCatalyst) {
      yieldUnits = 2;
    }
    storage.deposit(recipe.output, yieldUnits);
    this.smelts += 1;
  }

  // §4.3 — getter on a subclass.
  public get totalSmelts(): int16_t {
    return this.smelts;
  }
}

// §4.4 — Assembler specializes Workstation. Ingot/Plate → Gear/Circuit/Alloy.
export class Assembler extends Workstation {
  private builds: int16_t = 0;

  constructor() {
    super(StationKind.Assembler);
  }

  public override produces(): Material {
    return Material.Gear;
  }

  protected override craft(recipe: Recipe, storage: Stockpile): void {
    // Assemblers are exact: one output unit per craft, no bonus.
    storage.deposit(recipe.output, 1);
    // §4.2 — this.x compound assignment.
    this.builds += 1;
  }

  public get totalBuilds(): int16_t {
    return this.builds;
  }
}

// A small free helper: pick the next recipe to run on `station` this tick,
// given the available stockpile. §3.1 — exported function declaration.
// Demonstrates a function taking class-instance pointers (§4.5) and a Recipe
// array.
export function pickRecipe(
  station: Workstation,
  recipes: Recipe[],
  storage: Stockpile,
): Recipe {
  const want = station.produces();
  // §2.2 — for...of over the recipe array.
  for (const r of recipes) {
    if (r.output !== want) {
      continue;
    }
    // Check feasibility.
    let feasible = true;
    for (let i = 0; i < r.inputs.length; i++) {
      if (storage.amountOf(r.inputs[i]!) < r.counts[i]!) {
        feasible = false;
      }
    }
    if (feasible) {
      return r;
    }
  }
  // §2.1 — fallback: the first recipe whose output we don't yet have in stock.
  for (const r of recipes) {
    if (storage.amountOf(r.output) < TICKS_PER_RUN) {
      return r;
    }
  }
  return recipes[0]!;
}
