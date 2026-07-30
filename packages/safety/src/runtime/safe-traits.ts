// Hand-rolled C++ type traits for the safety polyfills.
//
// AVR's avr-gcc ships neither <type_traits> nor <limits>. The SafeInt and
// SafeVariable polyfills need is_integral / is_signed / is_same for their
// static_asserts, but must not include <type_traits>. This helper returns a
// self-contained C++14 block (no includes) that defines a __tc_safe_traits
// namespace with exactly the traits the polyfills use.
//
// SPECIALIZATION DISCIPLINE (avoids redefinition errors):
// On AVR, the fixed-width typedefs alias the built-ins: int8_t == signed char,
// int16_t == short, int32_t == long (int is 16-bit on AVR). Specializing for
// BOTH a typedef and its underlying built-in is a redefinition error. So:
//   - is_integral / is_signed specialize the BUILT-IN types only (signed char,
//     short, int, long, long long, unsigned variants, char, bool). A lookup
//     via a typedef (is_integral<int32_t>) resolves to the built-in
//     specialization automatically because the typedef names the same type.
//   - bounds specializes the FIXED-WIDTH typedefs only (int8_t/int16_t/
//     int32_t/int64_t). Each typedef maps to exactly one specialization, and
//     the bounds values match the typedef's width (not the host 'int' width).

/** Returns the C++ source for the __tc_safe_traits block. Idempotent via the
 *  __TC_SAFE_TRAITS_DEFINED guard, so emitting it from both the SafeInt and
 *  SafeVariable polyfills is harmless (the second include is a no-op). */
export function emitSafeTraits(): string {
  return `
#ifndef __TC_SAFE_TRAITS_DEFINED
#define __TC_SAFE_TRAITS_DEFINED

// No #include here: the integer types come transitively from <Arduino.h> on
// embedded targets (which pulls <stdint.h>) and from the test harness's own
// includes on native. This mirrors the other safety polyfills (mode-table,
// vote) which use uint32_t with no explicit include.

namespace __tc_safe_traits {

// is_integral<T>: specialized on canonical built-in integer types only.
// Lookups via fixed-width typedefs (int8_t/int32_t/etc.) resolve to these
// because each typedef names the same type as its underlying built-in.
template <typename T> struct is_integral { static constexpr bool value = false; };
template <> struct is_integral<bool>               { static constexpr bool value = true; };
template <> struct is_integral<char>               { static constexpr bool value = true; };
template <> struct is_integral<signed char>        { static constexpr bool value = true; };
template <> struct is_integral<unsigned char>      { static constexpr bool value = true; };
template <> struct is_integral<short>              { static constexpr bool value = true; };
template <> struct is_integral<unsigned short>     { static constexpr bool value = true; };
template <> struct is_integral<int>                { static constexpr bool value = true; };
template <> struct is_integral<unsigned int>       { static constexpr bool value = true; };
template <> struct is_integral<long>               { static constexpr bool value = true; };
template <> struct is_integral<unsigned long>      { static constexpr bool value = true; };
template <> struct is_integral<long long>          { static constexpr bool value = true; };
template <> struct is_integral<unsigned long long> { static constexpr bool value = true; };

// is_signed<T>: specialized on canonical signed built-in integer types only.
template <typename T> struct is_signed { static constexpr bool value = false; };
template <> struct is_signed<signed char> { static constexpr bool value = true; };
template <> struct is_signed<short>       { static constexpr bool value = true; };
template <> struct is_signed<int>         { static constexpr bool value = true; };
template <> struct is_signed<long>        { static constexpr bool value = true; };
template <> struct is_signed<long long>   { static constexpr bool value = true; };

// is_same<T,U>: standard two-type trait.
template <typename T, typename U> struct is_same { static constexpr bool value = false; };
template <typename T> struct is_same<T, T> { static constexpr bool value = true; };

// bounds<T>: per-fixed-width min/max via literals + static_cast (no <limits>).
// Specialized on the FIXED-WIDTH typedefs only. Each typedef has a unique
// specialization whose bounds match that typedef's width (independent of the
// host 'int' width — critical because AVR's int is 16-bit while ESP32/native
// is 32-bit). int64_t is guarded because some freestanding toolchains lack it.
template <typename T> struct bounds;
template <> struct bounds<int8_t> {
  static constexpr int8_t kMin = static_cast<int8_t>(static_cast<uint8_t>(0x80u));
  static constexpr int8_t kMax = static_cast<int8_t>(0x7Fu);
};
template <> struct bounds<int16_t> {
  static constexpr int16_t kMin = static_cast<int16_t>(static_cast<uint16_t>(0x8000u));
  static constexpr int16_t kMax = static_cast<int16_t>(0x7FFFu);
};
template <> struct bounds<int32_t> {
  static constexpr int32_t kMin = static_cast<int32_t>(static_cast<uint32_t>(0x80000000u));
  static constexpr int32_t kMax = static_cast<int32_t>(0x7FFFFFFFu);
};
#if defined(__INT64_TYPE__)
template <> struct bounds<__INT64_TYPE__> {
  // Use unsigned-long-long literals (standard 'ull' suffix) and cast — the
  // 'ill' signed suffix is a GNU extension needing -fext-numeric-literals.
  static constexpr __INT64_TYPE__ kMin = static_cast<__INT64_TYPE__>(static_cast<unsigned long long>(0x8000000000000000ull));
  static constexpr __INT64_TYPE__ kMax = static_cast<__INT64_TYPE__>(static_cast<unsigned long long>(0x7FFFFFFFFFFFFFFFull));
};
#endif

}  // namespace __tc_safe_traits

#endif // __TC_SAFE_TRAITS_DEFINED
`.trim();
}
