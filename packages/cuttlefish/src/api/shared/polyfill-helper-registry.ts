// ---------------------------------------------------------------------------
// Polyfill helper registry
//
// Maps JS method call patterns to the __tc_* C++ helper function names
// that normalizeRawExpression produces. Used by program analysis to detect
// which polyfill helpers are actually needed by a program.
// ---------------------------------------------------------------------------

import type { RuntimePolyfillIR } from './polyfill-types.js';

/**
 * Maps a JS method call pattern (substring) to the __tc_* C++ helper
 * function names that normalizeRawExpression will emit for it.
 */
export const POLYFILL_HELPER_MAP: Record<string, string[]> = {
  // String methods
  '.toUpperCase(':  ['__tc_toUpperCase'],
  '.toLowerCase(':  ['__tc_toLowerCase'],
  '.trim(':         ['__tc_trim'],
  '.endsWith(':     ['__tc_endsWith'],
  '.lastIndexOf(':  ['__tc_lastIndexOf'],
  '.padStart(':     ['__tc_padStart', '__tc_padStart_default'],
  '.padEnd(':       ['__tc_padEnd', '__tc_padEnd_default'],
  '.repeat(':       ['__tc_repeat'],
  '.charAt(':       ['__tc_charAt'],
  '.charCodeAt(':   ['__tc_charCodeAt'],
  '.replace(':      ['__tc_replace'],
  '.split(':        ['__tc_split'],
  '.substring(':    ['__tc_substring2', '__tc_substring1'],
  '.includes(':     ['__tc_includes'],
  '.indexOf(':      ['__tc_indexOf'],
  '.slice(':        ['__tc_slice2', '__tc_slice1'],

  // Math methods
  'Math.random(':   ['__tc_random'],

  // Array methods
  '.join(':         ['__tc_join'],
  '.reverse(':      ['__tc_reverse'],
  '.shift(':        ['__tc_shift'],
  '.pop(':          ['__tc_pop'],
  '.unshift(':      ['__tc_unshift'],
  '.sort(':         ['__tc_sort', '__tc_sort_fn'],
  '.fill(':         ['__tc_fill', '__tc_fill3'],
  '.concat(':       ['__tc_concat'],
  '.splice(':       ['__tc_splice1', '__tc_splice2'],
  '.filter(':       ['__tc_filter'],
  '.map(':          ['__tc_map'],
  '.reduce(':       ['__tc_reduce', '__tc_reduce_no_init'],
  '.find(':         ['__tc_find'],
  '.findIndex(':    ['__tc_findIndex'],
  '.every(':        ['__tc_every'],
  '.some(':         ['__tc_some'],

  // Map helper methods (Object.keys/values/entries AND Map.values/keys/entries)
  '__tc_mapKeys(':   ['__tc_mapKeys'],
  '__tc_mapValues(': ['__tc_mapValues'],
  '__tc_mapEntries(': ['__tc_mapEntries'],
  '__tc_fromEntries(': ['__tc_fromEntries'],
  // Set helper methods (Set.values()/keys()/entries()) — demo #15 fix A
  '__tc_setValues(':   ['__tc_setValues'],
  '__tc_setEntries(':   ['__tc_setEntries'],

  // JSON helpers
  '__tc_jsonStringify(': ['__tc_jsonStringify'],
  '__tc_jsonParse(': ['__tc_jsonParse'],

  // Safety helpers — emitted by @typecad/safety's polyfills as global-scope
  // __tc_safety_* free functions (the polyfill-helper-registry extractor
  // expects __tc_* immediately followed by `(`, so namespaced names would be
  // missed). The call-pattern keys are the substrings program analysis scans
  // source for; the values are the __tc_safety_* names that
  // filterPolyfillHelpers matches in helperFunctions text.
  //
  // Two key forms per helper: the user-facing safe.* source spelling (which
  // program analysis sees in raw IR before lowering) and the lowered
  // __tc_safety_* spelling (which appears after the safety call-statement
  // transformer emits hal-op resolution text). Both map to the same helper.
  'safe.read(':                   ['__tc_safety_read_safe'],
  'safe.write(':                  ['__tc_safety_write_verify'],
  '__tc_safety_record_pin_mode(': ['__tc_safety_record_pin_mode'],
  '__tc_safety_read_safe(':       ['__tc_safety_read_safe'],
  '__tc_safety_write_verify(':    ['__tc_safety_write_verify'],
};

function extractHelperFunctionNames(funcDef: string): string[] {
  const matches = funcDef.matchAll(/\b(__tc_[A-Za-z0-9_]+)\s*\(/g);
  return [...new Set([...matches].map(m => m[1]))];
}

/**
 * Filter helper functions in RuntimePolyfillIR objects to only those
 * whose names appear in the usedHelpers set. Non-__tc_ helpers are always kept.
 */
export function filterPolyfillHelpers(
  polyfills: RuntimePolyfillIR[],
  usedHelpers: Set<string>,
): RuntimePolyfillIR[] {
  return polyfills.map(polyfill => ({
    ...polyfill,
    helperFunctions: polyfill.helperFunctions.filter(func => {
      const names = extractHelperFunctionNames(func);
      if (names.length === 0) return true;
      return names.some(name => usedHelpers.has(name));
    }),
  })).filter(polyfill =>
    polyfill.helperFunctions.length > 0 ||
    polyfill.forwardDeclarations.length > 0 ||
    polyfill.helperStructs.length > 0 ||
    polyfill.shimMacros.length > 0
  );
}
