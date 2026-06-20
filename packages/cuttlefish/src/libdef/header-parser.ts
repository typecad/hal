/**
 * Header parser for gen-decls.
 *
 * Parses C++ class declarations from .h files, capturing inheritance
 * (`class X : public Y`) and stripping #if/#ifdef/#ifndef preprocessor
 * blocks before parsing. See
 * docs/superpowers/specs/2026-06-20-gen-decls-inheritance-design.md.
 */

/** A single method/constructor signature. */
export interface ClassMethod {
  name: string;
  returnType: string;
  parameters: { type: string; name: string }[];
  isPublic: boolean;
}

/** A parsed C++ class with optional base class. */
export interface ParsedClass {
  name: string;
  methods: ClassMethod[];
  constructors: { parameters: { type: string; name: string }[] }[];
  baseClass?: string;
  source: "header" | "cpp";
}

/**
 * Strips #if / #ifdef / #ifndef ... #endif blocks (including nested
 * conditionals) from C++ source. Conditionally-compiled methods are
 * intentionally lost — narrower emitted API is preferable to parse failure.
 */
export function stripPreprocessorBlocks(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let removing = 0;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const isDirective = trimmed.startsWith("#");
    const directiveBody = isDirective ? trimmed.slice(1).trim() : "";

    if (removing > 0) {
      if (/^(if|ifdef|ifndef)\b/.test(directiveBody)) {
        removing++;
      } else if (/^endif\b/.test(directiveBody)) {
        removing--;
      }
      continue;
    }

    if (isDirective && /^(if|ifdef|ifndef)\b/.test(directiveBody)) {
      removing++;
      continue;
    }
    out.push(raw);
  }
  return out.join("\n");
}
