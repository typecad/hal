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
 * Normalizes C++ preprocessor directives so the class parser can see the
 * declarations. Semantics:
 *
 * - Include guards (`#ifndef X` immediately followed by `#define X`, and
 *   `#pragma once`): directives dropped, all guarded content kept.
 * - `#if` / `#ifdef` / `#ifndef` ... `#else` / `#elif` ... `#endif`: the
 *   FIRST branch's content is kept; `#else` / `#elif` branch content is
 *   dropped; all directives themselves are dropped. This preserves classes
 *   that real-world headers gate behind target conditionals (e.g.
 *   Adafruit_SPITFT wraps its whole class in `#if !defined(__AVR_ATtiny85__)`),
 *   at the cost of possibly emitting declarations from a branch that isn't
 *   active on the user's target. That's acceptable for .d.ts generation,
 *   where a slightly wider API surface beats no API surface.
 */
export function stripPreprocessorBlocks(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];

  // Each entry tracks one open `#if/#ifdef/#ifndef`:
  //   - `active`: is the CURRENT branch being kept?
  //   - `satisfied`: has ANY branch at this level already been kept?
  // A branch is active only if no prior branch was satisfied and all outer
  // levels are active.
  const branches: { active: boolean; satisfied: boolean }[] = [];
  // Macro names for open include guards; their content is always kept.
  const guardMacros: string[] = [];

  const keeping = (): boolean => branches.every(b => b.active);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const isDirective = trimmed.startsWith("#");
    const directiveBody = isDirective ? trimmed.slice(1).trim() : "";

    // Include-guard #endif: closes a guard (outermost open guard).
    if (/^endif\b/.test(directiveBody) && guardMacros.length > 0 && branches.length === 0) {
      guardMacros.pop();
      continue;
    }

    // Conditional directives (only meaningful when not inside a guard-only context).
    if (/^(if|ifdef|ifndef)\b/.test(directiveBody)) {
      // Is this an include-guard open (#ifndef X followed by #define X)?
      if (/^ifndef\s+(\w+)/.test(directiveBody) && guardMacros.length === branches.length) {
        const macro = /^ifndef\s+(\w+)/.exec(directiveBody)![1];
        let nextNonBlank: string | undefined;
        for (let j = i + 1; j < lines.length; j++) {
          const t = lines[j].trim();
          if (t.length > 0) {
            nextNonBlank = t.startsWith("#") ? t.slice(1).trim() : t;
            break;
          }
        }
        if (nextNonBlank && new RegExp(`^define\\s+${macro}(\\s|$)`).test(nextNonBlank)) {
          guardMacros.push(macro);
          continue; // drop the #ifndef
        }
      }
      // Real conditional: first branch is active iff outer levels keep.
      const active = keeping();
      branches.push({ active, satisfied: active });
      continue;
    }

    // #elif / #else: switch to a new branch. Active only if outer keeps AND
    // no prior branch at this level was satisfied.
    if (/^(elif|else)\b/.test(directiveBody)) {
      if (branches.length === 0) continue;
      const outerKeeping = branches.slice(0, -1).every(b => b.active);
      const top = branches[branches.length - 1];
      top.active = outerKeeping && !top.satisfied;
      if (top.active) top.satisfied = true;
      continue;
    }

    if (/^endif\b/.test(directiveBody)) {
      if (branches.length > 0) branches.pop();
      continue;
    }

    // Guard's own #define — drop it.
    if (guardMacros.length > branches.length && /^define\s/.test(directiveBody)) {
      continue;
    }
    // `#pragma once` — drop the directive.
    if (/^pragma\s+once\b/.test(directiveBody)) {
      continue;
    }

    // Non-conditional content: keep if every open branch is keeping.
    if (keeping()) {
      out.push(raw);
    }
  }
  return out.join("\n");
}

/** Maps C++ types to TypeScript types (mirrors cpp-to-decl's type mapper). */
function mapCppTypeToTs(cppType: string): string {
  const trimmed = cppType.trim();
  const withoutConst = trimmed.replace(/^const\s+/, "");
  const typeMap: Record<string, string> = {
    "int": "number",
    "unsigned int": "number",
    "uint8_t": "number",
    "uint16_t": "number",
    "uint32_t": "number",
    "int8_t": "number",
    "int16_t": "number",
    "int32_t": "number",
    "float": "number",
    "double": "number",
    "bool": "boolean",
    "void": "void",
    "char": "string",
    "char*": "string",
    "const char*": "string",
    "std::string": "string",
    "String": "string",
  };
  if (typeMap[withoutConst]) return typeMap[withoutConst];
  if (withoutConst.endsWith("*")) return "number";
  if (withoutConst.endsWith("&")) return mapCppTypeToTs(withoutConst.slice(0, -1).trim());
  return "any";
}

/** Extracts parameters from a C++ parameter list string. */
function parseParameters(paramString: string): { type: string; name: string }[] {
  if (!paramString.trim()) return [];
  const params: { type: string; name: string }[] = [];
  for (const part of paramString.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const withoutDefault = trimmed.split("=")[0].trim();
    const tokens = withoutDefault.split(/\s+/);
    if (tokens.length >= 2) {
      // C++ lets pointer/reference markers attach to either the type
      // (`char* label`) or the name (`char *label`), and arrays appear as a
      // trailing `[]` on the name. Peel leading `*`/`&` and trailing `[]`
      // off the name token back onto the type, so the emitted name is a
      // valid TS identifier and the type still routes through
      // mapCppTypeToTs (which maps pointers/refs appropriately).
      let name = tokens[tokens.length - 1];
      const typeParts = tokens.slice(0, -1);
      const prefix: string[] = [];
      while (/^[*&]/.test(name)) {
        prefix.push(name[0]);
        name = name.slice(1);
      }
      // Trailing array marker on the name → treat as pointer for typing.
      let arrayMarker = "";
      if (/\[\]$/.test(name)) {
        arrayMarker = "*";
        name = name.replace(/\[\]$/, "");
      }
      if (prefix.length > 0 || arrayMarker) {
        typeParts.push((prefix.join("") + arrayMarker) || "");
      }
      params.push({
        name,
        type: mapCppTypeToTs(typeParts.join(" ").trim()),
      });
    } else if (tokens.length === 1) {
      params.push({ type: mapCppTypeToTs(tokens[0]), name: "" });
    }
  }
  return params;
}

/**
 * Parses a header source string into ParsedClass[]. Strips #if blocks first,
 * then finds `class Name [: access Base] { ... }` blocks and extracts public
 * methods + constructors.
 */
export function parseHeader(content: string): ParsedClass[] {
  const cleaned = stripPreprocessorBlocks(content);
  const classes: ParsedClass[] = [];

  // class Name [: (public|protected|private) Base [, access Base2 ...]] {
  // Group 1 = class name, group 2 = optional first base name. Additional
  // bases after the first are consumed by `(?:\s*,\s*(?:public|protected|private)\s+\w+)*`
  // but not captured (multiple inheritance beyond the first base is a
  // documented limitation).
  const classRegex = /\bclass\s+(\w+)\s*(?::\s*(?:public|protected|private)\s+(\w+)(?:\s*,\s*(?:public|protected|private)\s+\w+)*)?\s*\{/g;
  let m: RegExpExecArray | null;

  while ((m = classRegex.exec(cleaned)) !== null) {
    // Skip templated classes: a `template<...>` declaration immediately
    // precedes the class keyword on the preceding non-empty content.
    const preceding = cleaned.slice(0, m.index).replace(/\s+$/, "");
    if (/template\s*<[^>]*>\s*$/.test(preceding)) {
      continue;
    }

    const name = m[1];
    const baseClass = m[2];
    const bodyStart = m.index + m[0].length;

    // Find matching closing brace.
    let depth = 1;
    let bodyEnd = bodyStart;
    for (let i = bodyStart; i < cleaned.length && depth > 0; i++) {
      if (cleaned[i] === "{") depth++;
      else if (cleaned[i] === "}") depth--;
      bodyEnd = i;
    }
    const body = cleaned.slice(bodyStart, bodyEnd);

    const cls: ParsedClass = {
      name,
      methods: [],
      constructors: [],
      baseClass,
      source: "header",
    };

    // Split body by access specifiers.
    const normalized = body.replace(/\s+/g, " ");
    const segments: { text: string; isPublic: boolean }[] = [];
    let isPublic = false;
    for (const p of normalized.split(/(public:|private:|protected:)/)) {
      const t = p.trim();
      if (t === "public:") isPublic = true;
      else if (t === "private:" || t === "protected:") isPublic = false;
      else if (t) segments.push({ text: t, isPublic });
    }

    for (const seg of segments) {
      // Methods with a return type: type name(params) [const] {|;
      const methodRe = /(\w+(?:\s*[*&])?)\s+(\w+)\s*\(([^)]*)\)\s*(?:const\s*)?(?:\{|;)/g;
      let mm: RegExpExecArray | null;
      while ((mm = methodRe.exec(seg.text)) !== null) {
        const returnType = mm[1].trim();
        const methName = mm[2].trim();
        const params = mm[3];
        if (methName === name) {
          cls.constructors.push({ parameters: parseParameters(params) });
        } else {
          cls.methods.push({
            name: methName,
            returnType: mapCppTypeToTs(returnType),
            parameters: parseParameters(params),
            isPublic: seg.isPublic,
          });
        }
      }

      // Constructors without a return type: ClassName(params) {|;
      // (the method regex above requires a leading type token, so bare
      // constructors are missed without this pass).
      const ctorRe = new RegExp(`\\b(${name})\\s*\\(([^)]*)\\)\\s*(?:\\{|;)`, "g");
      let cm: RegExpExecArray | null;
      while ((cm = ctorRe.exec(seg.text)) !== null) {
        const params = cm[2];
        const already = cls.constructors.some(
          c => c.parameters.length === parseParameters(params).length,
        );
        if (!already) {
          cls.constructors.push({ parameters: parseParameters(params) });
        }
      }
    }

    classes.push(cls);
  }

  return classes;
}
