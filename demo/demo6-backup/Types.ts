// ---------------------------------------------------------------------------
// Types.ts — shared types, const enums, interfaces, and tunables for Forge.
//
// SUPPORT_MATRIX tour for Demo #6:
//   §1.6  interfaces → structs (Recipe, RunStats, Resource, CatalogEntry)
//   §1.7  const enum (Material) — value-typed enum used as struct field
//   §1.7  const enum with explicit/computed values (StationKind)
//   §1.1  top-level const tunables (number-typed; emitted as extern)
//   §6.2  multi-file imports of types/enums/functions
//
// Notes on patterns deliberately avoided (see README "Transpilation issues"):
//   - We do NOT export a top-level `const X: T[] = [...]` array of structs
//     across files. Such arrays are emitted into the .cpp only (no matching
//     extern decl lands in the .h), so consumers in other TUs see
//     "was not declared in this scope". Recipes are built by a factory
//     function in Recipes.ts instead (§3.1 function declaration).
//   - We do NOT use optional struct fields (`x?: T`) checked via
//     `!== undefined`. The optional flattens to `T` and the `CUTTLEFISH_UNDEFINED`
//     macro the check lowers to is only #defined in the .cpp shim, not in the
//     header where the method body is inlined — producing
//     "CUTTLEFISH_UNDEFINED was not declared". We use an explicit boolean flag.
// ---------------------------------------------------------------------------

// §1.7 — a value-typed material enum. Used as a struct field, an array index
// hint, and a switch discriminator. Const enums inline at use sites.
export const enum Material {
  Ore = 0,
  Coal = 1,
  Ingot = 2,
  Plate = 3,
  Gear = 4,
  Circuit = 5,
  Alloy = 6,
}

// §1.7 — explicit + computed enum values (exercises both lowering paths).
export const enum StationKind {
  Smelter = 1,
  Assembler = Smelter + 1,
  Forge = Assembler + 1,
}

// §1.6 — a recipe: a list of input materials and the output. `inputs` is typed
// `Material[]` (not `int16_t[]`) so that indexing yields a `Material` value,
// matching the `amountOf(Material)` / `withdraw(Material, ...)` signatures.
// `hasCatalyst` is an explicit boolean rather than an optional field — see the
// note above about optional struct fields + `!== undefined`.
export interface Recipe {
  id: int16_t;
  output: Material;
  inputs: Material[];
  counts: int16_t[];
  hasCatalyst: boolean;
  energy: int16_t;
}

// §1.6 — a single material slot in the global stockpile.
export interface Resource {
  kind: Material;
  amount: int16_t;
}

// §1.6 — a catalog entry: a material paired with its display name.
export interface CatalogEntry {
  kind: Material;
  name: string;
}

// §1.6 — end-of-run aggregate stats. Returned by value from Forge.summarize().
export interface RunStats {
  ticksRun: int16_t;
  craftsCompleted: int16_t;
  craftsAttempted: int16_t;
  energyConsumed: int16_t;
  materialsConsumed: int16_t;
}

// Tunables (§1.1 top-level const). These are number-typed scalars, which emit
// cleanly as `extern const int16_t` in the header + definition in the .cpp.
export const TICKS_PER_RUN: int16_t = 64;
export const STARTER_ORE: int16_t = 40;
export const STARTER_COAL: int16_t = 24;
export const STOCKPILE_CAPACITY: int16_t = 999;

// Build the material catalog inside a function (§3.1) rather than as a
// top-level const array. A returned `CatalogEntry[]` is a local whose lifetime
// is bounded to the caller's scope, which lowers cleanly. (Top-level const
// arrays of object literals lower to a shadow `_name_t` struct + vector, which
// doesn't yet round-trip through the cross-file extern path for the object-
// literal case — see README issue A note.)
export function buildCatalog(): CatalogEntry[] {
  const catalog: CatalogEntry[] = [];
  catalog.push({ kind: Material.Ore, name: 'ore' });
  catalog.push({ kind: Material.Coal, name: 'coal' });
  catalog.push({ kind: Material.Ingot, name: 'ingot' });
  catalog.push({ kind: Material.Plate, name: 'plate' });
  catalog.push({ kind: Material.Gear, name: 'gear' });
  catalog.push({ kind: Material.Circuit, name: 'circuit' });
  catalog.push({ kind: Material.Alloy, name: 'alloy' });
  return catalog;
}

// Convert a Material enum value to its display name. §2.4 — switch over an
// enum discriminator. The default arm is unreachable but keeps TS exhaustiveness
// honest and gives C++ a fallthrough return.
export function materialName(m: Material): string {
  switch (m) {
    case Material.Ore:
      return 'ore';
    case Material.Coal:
      return 'coal';
    case Material.Ingot:
      return 'ingot';
    case Material.Plate:
      return 'plate';
    case Material.Gear:
      return 'gear';
    case Material.Circuit:
      return 'circuit';
    case Material.Alloy:
      return 'alloy';
    default:
      return '?';
  }
}
