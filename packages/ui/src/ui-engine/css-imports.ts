// ---------------------------------------------------------------------------
// CSS @import expansion — build-time stylesheet inclusion.
//
// Local @import statements are inlined before parsing so shared stylesheets
// (e.g. the shadcn preset added by `cuttlefish add shadcn`) compose with
// per-module CSS, like a browser resolving imports. Relative paths resolve
// against the importing stylesheet's directory; recursion is supported with a
// cycle guard. Remote (http/data:) imports and unreadable files are left in
// place — the CSS parser's existing "@import is not supported" warning then
// reports them instead of failing silently.
//
// This is compile-time inclusion only: each firmware build still targets one
// display, so there is no runtime fetch.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

/** Guard against runaway include chains (distinct-file budget across the
 *  whole expansion; cycles are caught by the seen-set, this bounds depth). */
const MAX_INCLUDED_FILES = 32;

const IMPORT_RE = /@import\s+(?:url\(\s*)?["']?([^"'()\s;]+)["']?\s*\)?\s*[^;]*;/g;

/** Inline local @import statements in `cssText`. `baseDir` is the directory
 *  of the stylesheet the text came from. `seen` tracks normalized absolute
 *  paths already inlined (cycle guard) across the whole expansion. */
export function expandCssImports(cssText: string, baseDir: string, seen: Set<string> = new Set()): string {
  return cssText.replace(IMPORT_RE, (match, spec: string) => {
    if (/^(https?|data):/i.test(spec)) return match;
    const abs = path.normalize(path.isAbsolute(spec) ? spec : path.join(baseDir, spec));
    if (seen.has(abs) || seen.size >= MAX_INCLUDED_FILES) return "";
    seen.add(abs);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf-8");
    } catch {
      return match; // unreadable: keep the statement so the parser warns
    }
    return expandCssImports(text, path.dirname(abs), seen);
  });
}
