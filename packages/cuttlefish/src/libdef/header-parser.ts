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
      params.push({
        name: tokens[tokens.length - 1],
        type: mapCppTypeToTs(tokens.slice(0, -1).join(" ")),
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
