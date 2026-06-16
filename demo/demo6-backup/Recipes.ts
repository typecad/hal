// ---------------------------------------------------------------------------
// Recipes.ts — the recipe book. Built by a factory function + a generic helper.
//
// SUPPORT_MATRIX tour:
//   §3.1  exported function declarations (buildRecipes, complexity, sumIds)
//   §1.6  object literal → struct initializer (parallel Recipe interface)
//   §1.7  enum values in literal positions
//   §1.11 generic function with constraint → C++ template + static_assert
//   §3.2  rest parameter → std::vector<T>
//   §2.2  for...of over arrays
// ---------------------------------------------------------------------------

import { Material, Recipe } from './Types';

// §3.1 — factory: build the recipe catalog. Each object literal becomes a
// Recipe struct initializer pushed into the returned vector. (A top-level
// const array of object literals lowers to a shadow `_name_t` struct + vector
// that doesn't yet round-trip through the cross-file extern path — see README
// issue A note. A factory returning a local vector lowers cleanly.)
export function buildRecipes(): Recipe[] {
  const recipes: Recipe[] = [];
  recipes.push({
    id: 1,
    output: Material.Ingot,
    inputs: [Material.Ore, Material.Coal],
    counts: [2, 1],
    hasCatalyst: true,
    energy: 2,
  });
  recipes.push({
    id: 2,
    output: Material.Plate,
    inputs: [Material.Ingot],
    counts: [1],
    hasCatalyst: false,
    energy: 1,
  });
  recipes.push({
    id: 3,
    output: Material.Gear,
    inputs: [Material.Plate],
    counts: [2],
    hasCatalyst: false,
    energy: 2,
  });
  recipes.push({
    id: 4,
    output: Material.Circuit,
    inputs: [Material.Plate, Material.Coal],
    counts: [1, 1],
    hasCatalyst: false,
    energy: 3,
  });
  recipes.push({
    id: 5,
    output: Material.Alloy,
    inputs: [Material.Ingot, Material.Coal],
    counts: [2, 2],
    hasCatalyst: true,
    energy: 4,
  });
  return recipes;
}

// §1.11 — a generic function with a constraint. Lowers to a C++ template with
// a static_assert mirroring the constraint. The template definition is emitted
// in the header (demo #6 fix F) so cross-file instantiation links.
export function complexity<T extends Recipe>(recipe: T): int16_t {
  let inputSum: int16_t = 0;
  // §2.2 — index-based read over the parallel arrays.
  for (let i = 0; i < recipe.inputs.length; i++) {
    inputSum += recipe.counts[i]!;
  }
  return inputSum + recipe.energy;
}

// §3.2 — checksum across a vector of recipe ids. Implemented as a plain
// `int16_t[]` parameter rather than a rest parameter (`...ids: int16_t[]`)
// because a rest-param *call* with literal args (`sumIds(1,2,3)`) is not packed
// into a vector at the call site (needs a function-signature table — see
// README issue E note). The spread-of-a-vector case (`sumIds(...arr)`) IS now
// fixed (demo #6 fix E), but the literal-args case is not. We take a plain
// array parameter to cover both call shapes uniformly.
export function sumIds(ids: int16_t[]): int16_t {
  let sum: int16_t = 0;
  for (const id of ids) {
    // §5.1 — bitwise mix (XOR + rotate via shifts).
    sum = ((sum << 1) ^ id) & 0x7FFF;
  }
  return sum;
}
