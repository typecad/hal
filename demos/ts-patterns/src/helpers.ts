// ---------------------------------------------------------------------------
// helpers.ts — the gallery's multi-file companion module.
//
// Exports consumed by main.ts through BOTH import forms: a plain named
// import (formatPairs) and an ALIASED import (computeScore as score).
// The aliased form exercises the ImportIR.importAliases plumbing (call
// sites and reachability key on the exported name); this module being a
// separate user TU exercises split-file emission (helper declaration in
// its header, definition in its .cpp, cross-module call from main).
// ---------------------------------------------------------------------------

export function formatPairs(pairs: number[]): string {
  let out = '';
  for (let i = 0; i < pairs.length; i += 2) {
    if (i > 0) {
      out += ',';
    }
    out += `${pairs[i]}:${pairs[i + 1]}`;
  }
  return out;
}

export function computeScore(base: number, bonus: number): number {
  return base * 10 + bonus;
}

// NOTE: a module-level `export const TAG = '...'` lowers to a file-scope
// `const std::string` whose DESTRUCTOR crashes Zephyr's post-main teardown
// (EXCCAUSE 28 after return 0 — documented finding). A returned string
// avoids static storage entirely; the cross-module pattern is unchanged.
export function helperTag(): string {
  return 'multi-file';
}
