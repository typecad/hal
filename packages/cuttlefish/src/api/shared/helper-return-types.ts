// ---------------------------------------------------------------------------
// Helper return types — the single source of truth for what a `__tc_*`
// runtime helper RETURNS, in the canonical classification the type inference
// consumes ("std::string" / "bool" / "int" / "double" / …).
//
// Why this exists: the string model is dual (std::string on hosted targets,
// const char* + static rings on embedded ones), so EVERY consumer of a
// helper result — the specifier ladder, concat detection, argument shaping —
// needs the same "is this a string?" answer. That knowledge used to live in
// three parallel regex arms of the expression renderer (method-call, call,
// raw), and every new helper had to be added to all three — `__tc_num_radix`
// shipped in the polyfills but was missing from every arm, so
// `${n.toString(16)}` printed a pointer through %d (bench-supervisor demo).
//
// When you add a helper to a polyfill, add its return type HERE once; every
// consumer picks it up.
// ----------------------------------------------------------------------------

/** Canonical return classification per `__tc_*` helper name. */
export const HELPER_RETURN_TYPES: Readonly<Record<string, string>> = {
  // String-producing helpers (the primary const char* forms and the
  // std::string overloads share a name — one entry covers both).
  __tc_toUpperCase: 'std::string',
  __tc_toLowerCase: 'std::string',
  __tc_trim: 'std::string',
  __tc_replace: 'std::string',
  __tc_charAt: 'std::string',
  __tc_substring1: 'std::string',
  __tc_substring2: 'std::string',
  __tc_slice1: 'std::string',
  __tc_slice2: 'std::string',
  __tc_padStart: 'std::string',
  __tc_padStart_default: 'std::string',
  __tc_padEnd: 'std::string',
  __tc_padEnd_default: 'std::string',
  __tc_repeat: 'std::string',
  __tc_jsonStringify: 'std::string',
  __tc_toFixed: 'std::string',
  __tc_num_radix: 'std::string',
  __tc_join: 'std::string',

  // Boolean predicates.
  __tc_startsWith: 'bool',
  __tc_endsWith: 'bool',
  __tc_includes: 'bool',

  // Integer producers (indices, code units).
  __tc_charCodeAt: 'int',
  __tc_indexOf: 'int',
  __tc_lastIndexOf: 'int',

  // Numeric producers.
  __tc_random: 'double',

  // Vector-of-string producers.
  __tc_split: 'std::vector<std::string>',
};

/** Extract a leading `__tc_*` helper name from rendered C++ text, if any.
 *  Handles both call forms (`__tc_trim(s)`) and member-ish spellings that
 *  survive into raw text (`__tc_trim(s).c_str()` — still the helper). */
export function helperNameFromText(text: string): string | undefined {
  const m = text.trim().match(/^(__tc_[A-Za-z0-9_]+)/);
  return m?.[1];
}

/** The canonical return type for a helper named in rendered C++ text, or
 *  undefined when the text does not begin with a known `__tc_*` call. */
export function helperReturnTypeForText(text: string): string | undefined {
  const name = helperNameFromText(text);
  return name !== undefined ? HELPER_RETURN_TYPES[name] : undefined;
}
