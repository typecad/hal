// ---------------------------------------------------------------------------
// Header linkage check — structural invariants for split-mode headers,
// validated over the FINAL header lines right before they are written.
//
// Two bug classes from the demo rounds are generalized here:
//
//  1. non-inline-definition — a free function DEFINITION in a header (not
//     `inline`, not a template) defines an external symbol in every
//     including TU and fails the link with multiple-definition errors. The
//     string polyfills shipped this way until every definition went inline
//     (bench-supervisor: two TUs including the block).
//
//  2. late-prototype — a free-function PROTOTYPE emitted after the class
//     definitions, while an inline class body ABOVE it calls the function.
//     Inline method bodies live in the header, so a prototype below the
//     class is invisible to them ("was not declared in this scope" — the
//     severityLabel finding). Only flagged when a preceding class body
//     actually references the symbol, so post-class prototypes nothing
//     inline calls (e.g. ISR shims used from the .cpp) stay legal.
//
// The check is a pure function over lines so it is unit-testable and cheap;
// finalizeOutput turns findings into error diagnostics, failing the build at
// emit time instead of at g++/ld time on some far-away machine.
// ---------------------------------------------------------------------------

export interface HeaderLinkageIssue {
  /** 0-based line index of the offending line. */
  line: number;
  kind: "non-inline-definition" | "late-prototype";
  /** The function symbol involved. */
  symbol: string;
}

/** Match a top-level (unindented) line that is part of the code, not
 *  preamble: not a comment, preprocessor directive, or blank. */
function isTopLevelCode(line: string): boolean {
  const t = line.trimEnd();
  if (t.length === 0) return false;
  if (/^\s/.test(line)) return false; // indented — class/function body
  if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("#")) return false;
  return true;
}

/** Extract the declared function name from a signature line: the last
 *  identifier immediately before the first `(`. */
function signatureName(line: string): string | undefined {
  const m = line.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  return m?.[1];
}

/** True when the line begins a top-level class/struct definition. */
function isTypeDefinitionStart(line: string): boolean {
  return /^(?:final\s+)?(?:class|struct)\s+\w/.test(line) && line.trimEnd().endsWith("{");
}

/** Find the extent of the type definition opened at `start` (brace balance
 *  to its closing `};` at column 0). Returns the exclusive end index. */
function typeBodyEnd(lines: string[], start: number): number {
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth += 1; opened = true; }
      else if (ch === "}") { depth -= 1; }
    }
    if (opened && depth === 0) return i + 1;
  }
  return lines.length;
}

/** Validate a final split-mode header's linkage invariants. */
export function findHeaderLinkageIssues(lines: string[]): HeaderLinkageIssue[] {
  const issues: HeaderLinkageIssue[] = [];

  // Collect top-level type-definition extents so we can (a) skip their
  // bodies for rule 1 (method definitions inside classes are fine) and
  // (b) gather the symbols their INLINE bodies call for rule 2.
  const typeRanges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (isTopLevelCode(lines[i]) && isTypeDefinitionStart(lines[i])) {
      const end = typeBodyEnd(lines, i);
      typeRanges.push({ start: i, end });
      i = end - 1; // continue after this type
    }
  }
  const insideType = (idx: number): boolean =>
    typeRanges.some(r => idx >= r.start && idx < r.end);

  // Rule 1: non-inline free function definitions at top level.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isTopLevelCode(line) || insideType(i)) continue;
    const t = line.trimEnd();
    // A definition (single- or multi-line): a parameter list AND a body
    // opener on the line. Braced variable initializers (`T x[] = { … };`)
    // carry no `(` and stay outside the rule.
    if (!t.includes("{") || !t.includes("(") || t.endsWith(";")) continue;
    // Exempt the forms that are legal in headers: inline, templates (ODR
    // exempt), static (internal linkage — wasteful but legal), and type /
    // using / typedef / extern declarations (no `{` anyway, belt+braces).
    if (/^(inline|template|static|class|struct|enum|typedef|using|extern|friend)\b/.test(t)) continue;
    const name = signatureName(t);
    if (name) {
      issues.push({ line: i, kind: "non-inline-definition", symbol: name });
    }
  }

  // Rule 2: prototypes after the FIRST type definition whose symbol is
  // called from an inline body inside an EARLIER type definition.
  const firstTypeStart = typeRanges.length > 0 ? typeRanges[0].start : -1;
  if (firstTypeStart >= 0) {
    // Symbol calls inside each type body, in declaration order.
    const callsPerType: Array<{ end: number; calls: Set<string> }> = [];
    for (const r of typeRanges) {
      const calls = new Set<string>();
      for (let i = r.start; i < r.end; i++) {
        // A `friend` declaration NAMES a free function without calling it —
        // the class body can see the symbol through it, so it must not count
        // as an earlier call (else every friend'd ISR shim prototype after
        // the class would false-positive).
        const body = lines[i].replace(/\bfriend\s+[^;{]*[;{]/g, " ");
        for (const m of body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
          // Skip C++ keywords that precede parens syntactically.
          if (!["if", "for", "while", "switch", "return", "sizeof", "catch"].includes(m[1])) {
            calls.add(m[1]);
          }
        }
      }
      callsPerType.push({ end: r.end, calls });
    }
    for (let i = firstTypeStart; i < lines.length; i++) {
      const line = lines[i];
      if (!isTopLevelCode(line) || insideType(i)) continue;
      const t = line.trimEnd();
      // A prototype: ends with `);`, has a parameter list, declares a
      // function (not an extern variable — those have no `(`).
      if (!t.endsWith(");") || !t.includes("(")) continue;
      if (/^(extern|typedef|using|class|struct|enum)\b/.test(t)) continue;
      // Template prototypes may legally trail (the definition is ODR-exempt
      // and typically follows immediately).
      if (i > 0 && /^\s*template\s*</.test(lines[i - 1])) continue;
      const name = signatureName(t);
      if (!name) continue;
      // Flag only when an EARLIER type body's inline code calls it.
      const calledEarlier = callsPerType.some(
        (tp, ti) => tp.end <= i && tp.calls.has(name) && typeRanges[ti].start < i,
      );
      if (calledEarlier) {
        issues.push({ line: i, kind: "late-prototype", symbol: name });
      }
    }
  }

  return issues;
}
