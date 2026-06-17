// ---------------------------------------------------------------------------
// main.ts — small inventory stock tracker (cuttlefish demo #15).
//
// A simple, idiomatic TypeScript program in its natural form: a Map catalog,
// Map.values() iteration, const bindings throughout, and a Set of reported
// categories. All four demo #15 transpilation gaps are now fixed in the
// transpiler, so this needs no workarounds:
//   A  Map.values()/keys()/entries() lower to __tc_mapValues/etc. helpers.
//   B  Map.get() lowers to const-correct .at() (reads on a const Map compile).
//   C  const-bound Set.add()/Map.delete() are demoted to non-const, and the
//      contradictory "suggest const" warning no longer fires for them.
//   D  const enum is required (lint-gated, by design).
// Multi-file (models/Item + driver).
// ---------------------------------------------------------------------------

import { Item, Category, makeItem, describe } from './models/Item';

// Build the catalog. Map<string, Item> lowers to std::map<string, Item>.
// `let` because the catalog is populated via .set() — a const binding would be
// demoted by the transpiler and flagged by no-mutating-method-on-const-collection.
function buildCatalog(): Map<string, Item> {
  let cat: Map<string, Item> = new Map();
  const items: Item[] = [
    makeItem('A1', 'Hammer', Category.Tool, 4, 12.5),
    makeItem('A2', 'Wrench', Category.Tool, 0, 8.0),
    makeItem('B1', 'Bread', Category.Food, 20, 2.5),
    makeItem('B2', 'Apple', Category.Food, 15, 0.5),
    makeItem('C1', 'Notebook', Category.Misc, 7, 3.25),
  ];
  for (const it of items) {
    cat.set(it.sku, it);
  }
  return cat;
}

// Sum the stock value across the catalog. Iterates Map.values() — now lowered
// to __tc_mapValues(cat), so `it` is an Item, not a std::pair.
function totalValue(cat: Map<string, Item>): double {
  let sum: double = 0;
  for (const it of cat.values()) {
    sum += it.stock * it.price;
  }
  return sum;
}

// Count how many lines fall into each category. Numeric switch with default.
function labelFor(c: Category): string {
  switch (c) {
    case Category.Food:
      return 'food';
    case Category.Tool:
      return 'tools';
    default:
      return 'other';
  }
}

// Entry point.
function main(): void {
  // const catalog; reads via .get()/.values() are now const-correct (fix B/A).
  const catalog: Map<string, Item> = buildCatalog();

  // Lookup a known SKU. Map.get()! asserts presence (.at() contract).
  const hammer: Item = catalog.get('A1')!;
  console.log(`lookup=${describe(hammer)}`);

  // Total stock value across all lines (Map.values() iteration — fix A).
  console.log(`total_value=${totalValue(catalog)}`);

  // Per-category count via a Map of primitives. `let` because it is mutated
  // via .set() (the const-collection lint rule would otherwise flag it).
  let perCategory: Map<string, int32_t> = new Map();
  for (const it of catalog.values()) {
    const key: string = labelFor(it.category);
    perCategory.set(key, (perCategory.has(key) ? perCategory.get(key)! : 0) + 1);
  }

  // Report each category line. `let` because the Set is mutated via .add().
  let reported: Set<string> = new Set();
  for (const it of catalog.values()) {
    const key: string = labelFor(it.category);
    if (reported.has(key)) {
      continue;
    }
    reported.add(key);
    console.log(`${key}=${perCategory.get(key)}`);
  }

  console.log('done');
}

main();
