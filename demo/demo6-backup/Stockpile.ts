// ---------------------------------------------------------------------------
// Stockpile.ts — the shared inventory all stations draw from and write to.
//
// SUPPORT_MATRIX tour:
//   §4.1  class with private/public/readonly fields, static factory, getters
//   §4.3  instance method, static method, getter (get totalDistinct)
//   §1.5  Map<Material, int16> stock counts; Set<Material> depleted set
//   §1.5  for...of over a Set and an array
//   §2.1  ternary in clamp
//   §5.1  arithmetic + compound assignment
//   §6.2  multi-file local import
//
// Notes on patterns deliberately avoided (see README "Transpilation issues"):
//   - Iteration over materials uses a CatalogEntry[] returned by
//     `buildCatalog()` (a factory call), NOT a top-level exported const array.
//     A top-level const array is not visible cross-file (no extern in the .h).
// ---------------------------------------------------------------------------

import {
  buildCatalog,
  CatalogEntry,
  Material,
  STOCKPILE_CAPACITY,
  materialName,
} from './Types';

// §4.1 — a class modeling the shared stockpile. All state mutation goes
// through methods so the invariants (non-negative, capacity-bounded) hold.
export class Stockpile {
  // §4.1 — private field. Transpiles to a private: section in the C++ struct.
  private stock: Map<Material, int16_t>;
  // §1.5 — Set<Material> tracks which materials have hit zero this run.
  // Used to report "first depletion events" without duplicates.
  private depleted: Set<Material>;
  // §4.1 — readonly field. Emits as a const member.
  public readonly createdAt: int16_t;

  // §4.2 — constructor with default parameter.
  constructor(createdAt: int16_t = 0) {
    this.createdAt = createdAt;
    this.stock = new Map<Material, int16_t>();
    this.depleted = new Set<Material>();
    // §1.5 — seed every catalogued material to zero.
    const catalog = buildCatalog();
    for (const entry of catalog) {
      this.stock.set(entry.kind, 0);
    }
  }

  // §4.1 — static factory method.
  static empty(): Stockpile {
    return new Stockpile(0);
  }

  // §4.3 — count of materials currently in stock.
  //
  // NOTE: this is a regular (non-const, non-getter) method rather than a
  // `get totalDistinct()` const getter. Inside a const getter, `.get(k)` on
  // the stock map lowered to the non-const `operator[]` (which inserts),
  // producing "discards qualifiers [-fpermissive]". A plain method avoids the
  // const-method restriction. (The const-getter + .get() combination is a
  // transpiler lowering gap — see README.)
  public countDistinct(): int16_t {
    let n: int16_t = 0;
    const catalog = buildCatalog();
    for (const entry of catalog) {
      if (this.amountOf(entry.kind) > 0) {
        n = n + 1;
      }
    }
    return n;
  }

  // Read the current count for a material (never undefined — seeded to 0).
  public amountOf(m: Material): int16_t {
    return this.stock.get(m)!;
  }

  // Add units of a material, clamped to capacity. Returns the actual delta.
  public deposit(m: Material, units: int16_t): int16_t {
    const current = this.stock.get(m)!;
    // §2.1 — ternary clamp. int16 arithmetic; compound assignment (§5.1).
    const next = current + units > STOCKPILE_CAPACITY
      ? STOCKPILE_CAPACITY
      : current + units;
    this.stock.set(m, next);
    const delta = next - current;
    return delta;
  }

  // Try to withdraw `units` of material `m`. Returns true on success, false
  // if there wasn't enough (in which case nothing is withdrawn).
  public withdraw(m: Material, units: int16_t): boolean {
    const current = this.stock.get(m)!;
    if (current < units) {
      // §1.5 — record the depletion if this withdrawal can't be satisfied.
      this.depleted.add(m);
      return false;
    }
    this.stock.set(m, current - units);
    if (current - units === 0) {
      this.depleted.add(m);
    }
    return true;
  }

  // Did `m` hit zero at some point during the run? (For end-of-run reporting.)
  public hasBeenDepleted(m: Material): boolean {
    return this.depleted.has(m);
  }

  // §4.3 — static method: format a one-line snapshot of non-empty materials.
  // Returns a string built via §1.4 concatenation.
  static format(storage: Stockpile): string {
    let out = '';
    const catalog = buildCatalog();
    for (const entry of catalog) {
      const amt = storage.amountOf(entry.kind);
      if (amt > 0) {
        out = out + materialName(entry.kind) + '=' + amt + ' ';
      }
    }
    return out;
  }
}
