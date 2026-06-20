export function accessorGetterName(prop: string): string {
  return `get${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
}

export function accessorSetterName(prop: string): string {
  return `set${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
}

/**
 * Matches a C++ INTEGRAL scalar type (the enum↔integral storage boundary in
 * SUPPORT_MATRIX §1.7). Used by the enum-storage cast sites to decide whether
 * a value/target is on the integral side of an `enum class` boundary that
 * needs a `static_cast`. Covers the signed/unsigned `char`/`short`/`int`/
 * `long` spellings, the fixed-width `<cstdint>` aliases, `size_t`, and `bool`
 * (bool participates: `Cell c = someBool` is the same boundary). Anchored so
 * it does not match container/pointer spellings (`std::vector<...>` etc.).
 *
 * Single source of truth — emit sites route through this instead of each
 * keeping their own inline regex (the prior `isNumericTarget` regex in
 * statement-renderer was one such divergent copy). Demo #32 Finding A.
 */
export const INTEGRAL_CPP_TYPE_RE =
  /^(?:unsigned\s+|signed\s+)?(?:bool|char|short|int|long(?:\s+long)?|float|double|u?int(?:8|16|32|64)_t|size_t)$/;
