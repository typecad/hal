export function accessorGetterName(prop: string): string {
  return `get${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
}

export function accessorSetterName(prop: string): string {
  return `set${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
}

/**
 * Matches a C++ INTEGRAL scalar type (the enum↔integral storage boundary).
 * Used by the enum-storage cast sites to decide whether
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

/**
 * Resolve the actual numeric value of every member in a numeric enum, applying
 * the TS/C++ auto-increment rule: an explicit value sets the counter, members
 * without one get the current counter then increment. Mirrors the per-member
 * logic the three emit sites use when emitting `= <value>`.
 */
export function resolveEnumValues(
  members: ReadonlyArray<{ value?: number | string }>,
): number[] {
  const values: number[] = [];
  let autoValue = 0;
  for (const m of members) {
    if (typeof m.value === "number") {
      values.push(m.value);
      autoValue = m.value + 1;
    } else {
      // String-valued member (mixed enum) or auto-increment numeric.
      values.push(autoValue);
      autoValue++;
    }
  }
  return values;
}

/**
 * Compute the narrowest C++ underlying type for a numeric `enum class`, given
 * the resolved member values. Returns the `: <type>` suffix string (or `""`
 * for the default `int`).
 *
 * The transpiler knows the full, closed value range of every enum at emit
 * time — something g++ cannot recover. Picking the narrowest type halves
 * storage for small enums on AVR (`enum class X` defaults to `int` = 2 bytes;
 * `enum class X : uint8_t` = 1 byte), which matters for state-machine fields,
 * opcodes, and pin-role arrays common on small-RAM targets.
 *
 * Narrowing is strictly safe: the values provably fit, and `enum class`
 * underlying-type specification is standard C++11. Widening to `: long` still
 * applies when a value exceeds the default-int range on targets where
 * `needsLargeEnumUnderlying` is true (AVR's 16-bit `int`).
 *
 * @param values The resolved numeric values of all enum members.
 * @param needsLargeEnumUnderlying Whether the target's `int` is smaller than
 *   32 bits (true on AVR). When true, values outside `[-32768, 32767]` widen
 *   to `: long`. When false (32-bit int), no widening is needed.
 */
export function narrowestEnumUnderlying(
  values: readonly number[],
  needsLargeEnumUnderlying: boolean,
): string {
  if (values.length === 0) return "";
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Widen to long first if any value overflows the target's default int range.
  if (needsLargeEnumUnderlying && (max > 32767 || min < -32768)) {
    return " : long";
  }
  // Narrow to the smallest type that fits the full [min, max] range.
  if (min >= 0 && max <= 255) return " : uint8_t";
  if (min >= -128 && max <= 127) return " : int8_t";
  return "";
}
