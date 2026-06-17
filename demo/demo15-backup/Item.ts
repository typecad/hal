// ---------------------------------------------------------------------------
// Item.ts — domain types for the inventory demo.
//
// Plain idiomatic TypeScript: a numeric enum, an interface, and two small
// factory/formatting helpers. These lower cleanly to C++ enums, structs, and
// free functions.
// ---------------------------------------------------------------------------

// Numeric enum with explicit values. const enum (inlined by the transpiler).
export const enum Category {
  Food = 1,
  Tool = 2,
  Misc = 3,
}

// Interface -> C++ struct. Fixed-width ints keep the generated code tidy.
export interface Item {
  sku: string;
  name: string;
  category: Category;
  stock: int32_t;
  price: double;
}

// Factory as a free function (lowers to a plain C++ free function).
export function makeItem(
  sku: string,
  name: string,
  category: Category,
  stock: int32_t,
  price: double,
): Item {
  return { sku: sku, name: name, category: category, stock: stock, price: price };
}

// Template literal + string method (.toLowerCase) used as a display label.
export function describe(i: Item): string {
  return `${i.sku} ${i.name.toLowerCase()} x${i.stock} @${i.price}`;
}
