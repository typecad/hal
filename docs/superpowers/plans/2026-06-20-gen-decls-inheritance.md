# gen-decls C++ Class Inheritance Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cuttlefish gen-decls` parse `.h` headers (in addition to `.cpp`), capture `class X : public Y` inheritance, and emit `extends` with cross-library `import type` resolution so typed instances inherit base-class methods.

**Architecture:** Extend the existing regex-based parser with three units in `packages/cuttlefish/src/libdef/`: a new `header-parser.ts` (parses class declarations + base classes from `.h`, strips `#if` blocks), a new `base-class-resolver.ts` (class-name → header-path index scoped to the scan root), and an extended `cpp-to-decl.ts` (merges `.h` + sibling `.cpp`, emits `extends`/`import type`/stub).

**Tech Stack:** TypeScript, Node.js `fs`/`path`, Vitest. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-06-20-gen-decls-inheritance-design.md`

---

## File Structure

**Create:**
- `packages/cuttlefish/src/libdef/header-parser.ts` — parses `.h` files into `ParsedClass[]`. Exports `parseHeader(content)`, `stripPreprocessorBlocks(content)`, and the shared `ParsedClass`/`ClassMethod` types.
- `packages/cuttlefish/src/libdef/base-class-resolver.ts` — `BaseClassResolver` class + `buildClassIndex(scanRoot)`.
- `tests/packages/transpiler/gen-decls-inheritance.test.ts` — Vitest tests.
- `tests/fixtures/cpp-inheritance/libA/Dependent.h` + `Dependent.cpp`
- `tests/fixtures/cpp-inheritance/libB/Base.h`

**Modify:**
- `packages/cuttlefish/src/libdef/cpp-to-decl.ts` — add `baseClass?`/`source` to `CppClass`; add `generateDecl()` (accepts `.h` or `.cpp`); emit `extends`/imports/stubs. Keep `generateDeclFromCpp` as a wrapper.
- `packages/cuttlefish/src/testing.ts` — re-export new symbols.
- `packages/cuttlefish/src/cli.ts` — single-file branch accepts `.h`, calls `generateDecl`.

**Keep unchanged:**
- `packages/cuttlefish/src/utils/cli.ts` — argument parsing already works for both `.h` and `.cpp` inputs.
- Type mappings and `.cpp` scope-resolution logic — reused as-is.

---

## Task 1: Shared types + `stripPreprocessorBlocks`

**Files:**
- Create: `packages/cuttlefish/src/libdef/header-parser.ts`
- Create: `tests/packages/transpiler/gen-decls-inheritance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/transpiler/gen-decls-inheritance.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { stripPreprocessorBlocks } from "@typecad/cuttlefish/testing";

describe("stripPreprocessorBlocks", () => {
  it("removes a single #if ... #endif block", () => {
    const input = [
      "void before();",
      "#if !defined(ESP8266)",
      "void guarded();",
      "#endif",
      "void after();",
    ].join("\n");
    const out = stripPreprocessorBlocks(input);
    expect(out).toContain("void before();");
    expect(out).toContain("void after();");
    expect(out).not.toContain("void guarded();");
    expect(out).not.toContain("#if");
    expect(out).not.toContain("#endif");
  });

  it("removes nested #if blocks", () => {
    const input = [
      "#if defined(A)",
      "void outer();",
      "#if defined(B)",
      "void inner();",
      "#endif",
      "void outerTail();",
      "#endif",
      "void after();",
    ].join("\n");
    const out = stripPreprocessorBlocks(input);
    expect(out).toContain("void after();");
    expect(out).not.toContain("void outer();");
    expect(out).not.toContain("void inner();");
  });

  it("leaves content with no preprocessor blocks unchanged except whitespace", () => {
    const input = "void foo();\nvoid bar();";
    expect(stripPreprocessorBlocks(input).trim()).toBe(input.trim());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts`
Expected: FAIL — `stripPreprocessorBlocks` is not exported from `@typecad/cuttlefish/testing`.

- [ ] **Step 3: Implement `header-parser.ts`**

Create `packages/cuttlefish/src/libdef/header-parser.ts`:

```typescript
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
```

- [ ] **Step 4: Re-export from `testing.ts`**

In `packages/cuttlefish/src/testing.ts`, after the existing `export { parseCommandLine } from "./utils/cli";` line, add:

```typescript
export { stripPreprocessorBlocks } from "./libdef/header-parser";
```

- [ ] **Step 5: Build the package**

Run: `cd C:/typecad/typecode/packages/cuttlefish && npm run build`
Expected: clean build (tsc exits 0, no output).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
cd C:/typecad/typecode
git add packages/cuttlefish/src/libdef/header-parser.ts packages/cuttlefish/src/testing.ts tests/packages/transpiler/gen-decls-inheritance.test.ts
git commit -m "feat(gen-decls): header parser types + #if block stripping"
```

---

## Task 2: `parseHeader` — class declarations + base classes

**Files:**
- Modify: `packages/cuttlefish/src/libdef/header-parser.ts`
- Modify: `tests/packages/transpiler/gen-decls-inheritance.test.ts`

- [ ] **Step 1: Add failing tests for `parseHeader`**

Update the import line in `tests/packages/transpiler/gen-decls-inheritance.test.ts` to:

```typescript
import { stripPreprocessorBlocks, parseHeader } from "@typecad/cuttlefish/testing";
```

Append a new `describe` block at the end of the file:

```typescript
describe("parseHeader", () => {
  it("parses a flat class with no base", () => {
    const h = "class Foo {\npublic:\n  Foo();\n  void bar(int x);\n};";
    const classes = parseHeader(h);
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe("Foo");
    expect(classes[0].baseClass).toBeUndefined();
    expect(classes[0].source).toBe("header");
    expect(classes[0].constructors).toHaveLength(1);
    expect(classes[0].methods.map(m => m.name)).toEqual(["bar"]);
  });

  it("captures a single-inheritance base class", () => {
    const h = "class Adafruit_ILI9341 : public Adafruit_SPITFT {\npublic:\n  void begin();\n};";
    const classes = parseHeader(h);
    expect(classes[0].name).toBe("Adafruit_ILI9341");
    expect(classes[0].baseClass).toBe("Adafruit_SPITFT");
  });

  it("captures protected/private inheritance as base too", () => {
    const h = "class Foo : protected Bar {\npublic:\n  void baz();\n};";
    expect(parseHeader(h)[0].baseClass).toBe("Bar");
  });

  it("parses multiple classes in one header", () => {
    const h = [
      "class Adafruit_GFX : public Print {",
      "public:",
      "  void fillRect();",
      "};",
      "class GFXcanvas1 : public Adafruit_GFX {",
      "public:",
      "  GFXcanvas1();",
      "};",
    ].join("\n");
    const classes = parseHeader(h);
    expect(classes.map(c => c.name)).toEqual(["Adafruit_GFX", "GFXcanvas1"]);
    expect(classes[1].baseClass).toBe("Adafruit_GFX");
  });

  it("ignores multiple inheritance beyond the first base", () => {
    const h = "class Foo : public A, public B {\npublic:\n  void x();\n};";
    expect(parseHeader(h)[0].baseClass).toBe("A");
  });

  it("ignores forward declarations (class with no body)", () => {
    const h = "class ForwardDecl;\nclass Real { public: void x(); };";
    expect(parseHeader(h).map(c => c.name)).toEqual(["Real"]);
  });

  it("ignores templated class declarations", () => {
    const h = "template <typename T>\nclass Templated { public: void x(); };";
    expect(parseHeader(h)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts`
Expected: FAIL — `parseHeader` is not exported.

- [ ] **Step 3: Implement `parseHeader`**

Append to `packages/cuttlefish/src/libdef/header-parser.ts`:

```typescript

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

  // class Name [: (public|protected|private) Base] {
  // Group 1 = class name, group 2 = optional first base name.
  const classRegex = /\bclass\s+(\w+)\s*(?::\s*(?:public|protected|private)\s+(\w+))?\s*\{/g;
  let m: RegExpExecArray | null;

  while ((m = classRegex.exec(cleaned)) !== null) {
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
    }

    classes.push(cls);
  }

  return classes;
}
```

- [ ] **Step 4: Re-export `parseHeader` from `testing.ts`**

In `packages/cuttlefish/src/testing.ts`, update the header-parser export to:

```typescript
export { parseHeader, stripPreprocessorBlocks } from "./libdef/header-parser";
```

- [ ] **Step 5: Build**

Run: `cd C:/typecad/typecode/packages/cuttlefish && npm run build`
Expected: clean build.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 7: Commit**

```bash
cd C:/typecad/typecode
git add packages/cuttlefish/src/libdef/header-parser.ts packages/cuttlefish/src/testing.ts tests/packages/transpiler/gen-decls-inheritance.test.ts
git commit -m "feat(gen-decls): parseHeader captures class declarations + base classes"
```

---

## Task 3: `BaseClassResolver` + `buildClassIndex`

**Files:**
- Create: `packages/cuttefish/src/libdef/base-class-resolver.ts`
- Modify: `packages/cuttlefish/src/testing.ts`
- Modify: `tests/packages/transpiler/gen-decls-inheritance.test.ts`

- [ ] **Step 1: Add failing tests for the resolver**

Update the import line in `tests/packages/transpiler/gen-decls-inheritance.test.ts` to:

```typescript
import {
  stripPreprocessorBlocks,
  parseHeader,
  BaseClassResolver,
} from "@typecad/cuttlefish/testing";
```

Append:

```typescript
describe("BaseClassResolver", () => {
  it("resolves a class indexed in a header", () => {
    const index = new Map([["Adafruit_SPITFT", "/lib/Adafruit_GFX_Library/Adafruit_SPITFT.h"]]);
    const resolver = new BaseClassResolver(index);
    expect(resolver.resolve("Adafruit_SPITFT")).toEqual({
      kind: "found",
      headerPath: "/lib/Adafruit_GFX_Library/Adafruit_SPITFT.h",
    });
  });

  it("returns external for an unknown class", () => {
    const index = new Map([["Adafruit_SPITFT", "/x.h"]]);
    const resolver = new BaseClassResolver(index);
    expect(resolver.resolve("Print")).toEqual({ kind: "external" });
  });

  it("returns external when the index is empty", () => {
    const resolver = new BaseClassResolver(new Map());
    expect(resolver.resolve("Anything")).toEqual({ kind: "external" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts`
Expected: FAIL — `BaseClassResolver` not exported.

- [ ] **Step 3: Implement `base-class-resolver.ts`**

Create `packages/cuttlefish/src/libdef/base-class-resolver.ts`:

```typescript
/**
 * Resolves a base class name to the header file that declares it.
 *
 * Scoped to the set of .h files under a scan root — no parent-directory
 * climbing. See
 * docs/superpowers/specs/2026-06-20-gen-decls-inheritance-design.md.
 */

import fs from "node:fs";
import path from "node:path";
import { parseHeader } from "./header-parser";

export type ResolveResult =
  | { kind: "found"; headerPath: string }
  | { kind: "external" };

export class BaseClassResolver {
  constructor(private readonly index: Map<string, string>) {}

  resolve(name: string): ResolveResult {
    const headerPath = this.index.get(name);
    if (headerPath !== undefined) {
      return { kind: "found", headerPath };
    }
    return { kind: "external" };
  }
}

/**
 * Walks a directory tree for .h files and builds Map<className, headerPath>.
 * First declaration wins (deterministic). Recursive.
 */
export function buildClassIndex(dir: string): Map<string, string> {
  const index = new Map<string, string>();
  if (!fs.existsSync(dir)) {
    return index;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [name, hp] of buildClassIndex(full)) {
        if (!index.has(name)) index.set(name, hp);
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".h")) {
      const content = fs.readFileSync(full, "utf8");
      for (const cls of parseHeader(content)) {
        if (!index.has(cls.name)) index.set(cls.name, full);
      }
    }
  }
  return index;
}
```

- [ ] **Step 4: Re-export from `testing.ts`**

Add to `packages/cuttlefish/src/testing.ts`:

```typescript
export { BaseClassResolver, buildClassIndex } from "./libdef/base-class-resolver";
export type { ResolveResult } from "./libdef/base-class-resolver";
```

- [ ] **Step 5: Build**

Run: `cd C:/typecad/typecode/packages/cuttlefish && npm run build`
Expected: clean build.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 7: Commit**

```bash
cd C:/typecad/typecode
git add packages/cuttlefish/src/libdef/base-class-resolver.ts packages/cuttlefish/src/testing.ts tests/packages/transpiler/gen-decls-inheritance.test.ts
git commit -m "feat(gen-decls): BaseClassResolver + buildClassIndex"
```

---

## Task 4: Fixtures + directory-walking index test

**Files:**
- Create: `tests/fixtures/cpp-inheritance/libA/Dependent.h`
- Create: `tests/fixtures/cpp-inheritance/libA/Dependent.cpp`
- Create: `tests/fixtures/cpp-inheritance/libB/Base.h`
- Modify: `tests/packages/transpiler/gen-decls-inheritance.test.ts`

- [ ] **Step 1: Create the fixtures**

Create `tests/fixtures/cpp-inheritance/libA/Dependent.h`:

```cpp
class Dependent : public Base {
public:
  Dependent(int x);
  void doThing();
};
```

Create `tests/fixtures/cpp-inheritance/libA/Dependent.cpp`:

```cpp
#include "Dependent.h"

Dependent::Dependent(int x) {
}

void Dependent::doThing() {
}
```

Create `tests/fixtures/cpp-inheritance/libB/Base.h`:

```cpp
class Base {
public:
  Base();
  void baseMethod();
};
```

- [ ] **Step 2: Add a directory-walking test**

Update the import line in `tests/packages/transpiler/gen-decls-inheritance.test.ts` to:

```typescript
import {
  stripPreprocessorBlocks,
  parseHeader,
  BaseClassResolver,
  buildClassIndex,
} from "@typecad/cuttlefish/testing";
import path from "node:path";
```

Append:

```typescript
describe("buildClassIndex", () => {
  it("indexes classes from .h files across subdirectories", () => {
    const root = path.resolve(__dirname, "../../../tests/fixtures/cpp-inheritance");
    const index = buildClassIndex(root);
    expect(index.get("Base")).toBe(path.join(root, "libB", "Base.h"));
    expect(index.get("Dependent")).toBe(path.join(root, "libA", "Dependent.h"));
  });
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 4: Commit**

```bash
cd C:/typecad/typecode
git add tests/fixtures/cpp-inheritance tests/packages/transpiler/gen-decls-inheritance.test.ts
git commit -m "test(gen-decls): fixtures + directory index for cross-lib resolution"
```

---

## Task 5: `generateDecl` — accepts `.h` or `.cpp`, merges siblings

**Files:**
- Modify: `packages/cuttlefish/src/libdef/cpp-to-decl.ts`
- Modify: `tests/packages/transpiler/gen-decls-inheritance.test.ts`

- [ ] **Step 1: Add failing tests for `generateDecl`**

Update the import line in `tests/packages/transpiler/gen-decls-inheritance.test.ts` to:

```typescript
import {
  stripPreprocessorBlocks,
  parseHeader,
  BaseClassResolver,
  buildClassIndex,
  generateDecl,
} from "@typecad/cuttlefish/testing";
import fs from "node:fs";
import os from "node:os";
```

Add a temp-dir helper near the top (after imports):

```typescript
function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-decls-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
```

Append:

```typescript
describe("generateDecl", () => {
  it("emits a flat class for a header with no base", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "Foo.h");
      fs.writeFileSync(h, "class Foo {\npublic:\n  void bar();\n};\n", "utf8");
      const out = generateDecl(h);
      expect(out).toBe(path.join(dir, "Foo.d.ts"));
      expect(fs.readFileSync(out!, "utf8")).toContain("export declare class Foo {");
    });
  });

  it("emits extends for a same-file base", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "GFX.h");
      fs.writeFileSync(h, [
        "class GFX { public: void fillRect(); };",
        "class Canvas1 : public GFX { public: Canvas1(); };",
      ].join("\n"));
      const out = generateDecl(h);
      const content = fs.readFileSync(out!, "utf8");
      expect(content).toContain("export declare class Canvas1 extends GFX {");
      expect(content).not.toContain("import type");
    });
  });

  it("merges .cpp impl-only methods into the .h class", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "Foo.h");
      const cpp = path.join(dir, "Foo.cpp");
      fs.writeFileSync(h, "class Foo {\npublic:\n  Foo();\n};\n", "utf8");
      fs.writeFileSync(cpp, "void Foo::extraMethod(int x) { }\n", "utf8");
      const out = generateDecl(h);
      const content = fs.readFileSync(out!, "utf8");
      expect(content).toContain("extraMethod(x: number): void;");
    });
  });

  it("writes .d.ts next to the input with matching basename", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "Foo.h");
      fs.writeFileSync(h, "class Foo { public: void bar(); };", "utf8");
      const out = generateDecl(h);
      expect(path.basename(out!)).toBe("Foo.d.ts");
      expect(path.dirname(out!)).toBe(dir);
    });
  });

  it("returns null when the file has no classes or constants", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "Empty.h");
      fs.writeFileSync(h, "// just a comment\n", "utf8");
      expect(generateDecl(h)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts`
Expected: FAIL — `generateDecl` not exported.

- [ ] **Step 3: Extend `CppClass` with the new fields**

In `packages/cuttlefish/src/libdef/cpp-to-decl.ts`, replace the `CppClass` interface (near lines 18-22):

```typescript
interface CppClass {
  name: string;
  methods: CppMethod[];
  constructors: { parameters: { type: string; name: string }[] }[];
}
```

with:

```typescript
interface CppClass {
  name: string;
  methods: CppMethod[];
  constructors: { parameters: { type: string; name: string }[] }[];
  baseClass?: string;
  source: "header" | "cpp";
}
```

- [ ] **Step 4: Update the two `.cpp`-parsing sites to set `source: "cpp"`**

In `parseCppClass` (inside `cpp-to-decl.ts`), find the `classesFromImpl.set(...)` call (around line 150) and add `source: "cpp"`:

```typescript
      if (!classesFromImpl.has(className)) {
        classesFromImpl.set(className, {
          name: className,
          methods: [],
          constructors: [],
          source: "cpp",
        });
      }
```

Find the `classStartRegex` path's `cppClass` literal (around line 200) and add `source: "cpp"`:

```typescript
    const cppClass: CppClass = {
      name: className,
      methods: [],
      constructors: [],
      source: "cpp",
    };
```

- [ ] **Step 5: Update `generateDeclaration` to emit `extends`**

In `generateDeclaration`, replace the class-emission loop header (around line 312-313):

```typescript
  for (const cppClass of parsed.classes) {
    lines.push(`export declare class ${cppClass.name} {`);
```

with:

```typescript
  for (const cppClass of parsed.classes) {
    const extendsClause = cppClass.baseClass ? ` extends ${cppClass.baseClass}` : "";
    lines.push(`export declare class ${cppClass.name}${extendsClause} {`);
```

- [ ] **Step 6: Add `generateDecl`**

At the top of `cpp-to-decl.ts`, add the header-parser import (after the existing `import path from "node:path";`):

```typescript
import { parseHeader, type ParsedClass } from "./header-parser";
```

Append at the end of `cpp-to-decl.ts`:

```typescript

/**
 * Generates a .d.ts from a .h OR .cpp file.
 *
 * - For .h: parses the header; if a sibling .cpp exists, merges its
 *   impl-only methods (ClassName::method) into the header's classes.
 * - For .cpp: if a sibling .h exists, parses the header and merges; else
 *   behaves as the legacy flattened path.
 *
 * Does NOT resolve cross-file base classes — bases from other headers are
 * left as bare `extends Foo` (no import). Cross-file resolution is added in
 * a later step for the directory-scan path.
 */
export function generateDecl(filePath: string, outputPath?: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  const baseNoExt = path.basename(filePath, ext);

  let headerPath: string | undefined;
  let cppPath: string | undefined;
  if (ext === ".h") {
    headerPath = filePath;
    const siblingCpp = path.join(dir, baseNoExt + ".cpp");
    cppPath = fs.existsSync(siblingCpp) ? siblingCpp : undefined;
  } else if (ext === ".cpp") {
    cppPath = filePath;
    const siblingH = path.join(dir, baseNoExt + ".h");
    headerPath = fs.existsSync(siblingH) ? siblingH : undefined;
  } else {
    return null;
  }

  let headerClasses: ParsedClass[] = [];
  if (headerPath) {
    headerClasses = parseHeader(fs.readFileSync(headerPath, "utf8"));
  }
  let cppResult: CppParseResult = { classes: [], constants: [] };
  if (cppPath) {
    cppResult = parseCppClass(fs.readFileSync(cppPath, "utf8"));
  }

  const merged: CppClass[] = [];
  const byName = new Map<string, CppClass>();
  for (const h of headerClasses) {
    const cls: CppClass = {
      name: h.name,
      methods: [...h.methods],
      constructors: [...h.constructors],
      baseClass: h.baseClass,
      source: "header",
    };
    byName.set(h.name, cls);
    merged.push(cls);
  }
  for (const c of cppResult.classes) {
    const existing = byName.get(c.name);
    if (existing) {
      for (const m of c.methods) {
        if (!existing.methods.some(em => em.name === m.name)) {
          existing.methods.push(m);
        }
      }
    } else {
      merged.push({ ...c, source: "cpp" });
    }
  }

  if (merged.length === 0 && cppResult.constants.length === 0) {
    return null;
  }

  const declaration = generateDeclaration({ classes: merged, constants: cppResult.constants });

  const outPath = outputPath || path.join(dir, baseNoExt + ".d.ts");
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, "utf8") !== declaration) {
    fs.writeFileSync(outPath, declaration, "utf8");
  }
  return outPath;
}
```

- [ ] **Step 7: Replace `generateDeclFromCpp` with a backward-compat wrapper**

The existing `generateDeclFromCpp` (around lines 343-366 in the original file) is now superseded by `generateDecl`. Delete the old implementation and replace it with a thin wrapper so existing imports (`cli.ts` still imports it until Task 7) keep resolving. Add this to the end of `cpp-to-decl.ts`:

```typescript

/** Backward-compat wrapper — delegates to generateDecl. */
export function generateDeclFromCpp(cppFilePath: string, outputPath?: string): string | null {
  return generateDecl(cppFilePath, outputPath);
}
```

Confirm the old standalone `generateDeclFromCpp` body is gone (only the wrapper remains), or tsc will error on the duplicate export.

- [ ] **Step 8: Re-export `generateDecl` from `testing.ts`**

Add to `packages/cuttlefish/src/testing.ts`:

```typescript
export { generateDecl } from "./libdef/cpp-to-decl";
```

- [ ] **Step 9: Build**

Run: `cd C:/typecad/typecode/packages/cuttlefish && npm run build`
Expected: clean build.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 11: Run the CLI regression suite**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-cli.test.ts`
Expected: PASS (6 tests — no regressions).

- [ ] **Step 12: Commit**

```bash
cd C:/typecad/typecode
git add packages/cuttlefish/src/libdef/cpp-to-decl.ts packages/cuttlefish/src/testing.ts tests/packages/transpiler/gen-decls-inheritance.test.ts
git commit -m "feat(gen-decls): generateDecl accepts .h/.cpp, merges siblings, emits extends"
```

---

## Task 6: Emitter emits `import type` + stubs (resolver-aware)

**Files:**
- Modify: `packages/cuttlefish/src/libdef/cpp-to-decl.ts`
- Modify: `tests/packages/transpiler/gen-decls-inheritance.test.ts`

- [ ] **Step 1: Add failing tests for cross-file resolution + stubs**

Update the import line in `tests/packages/transpiler/gen-decls-inheritance.test.ts` to:

```typescript
import {
  stripPreprocessorBlocks,
  parseHeader,
  BaseClassResolver,
  buildClassIndex,
  generateDecl,
  generateDeclsForDirectory,
} from "@typecad/cuttlefish/testing";
```

Add a cleanup helper near the top (after the `withTempDir` helper):

```typescript
function cleanDecls(root: string) {
  if (!fs.existsSync(root)) return;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      cleanDecls(full);
    } else if (e.name.endsWith(".d.ts")) {
      fs.rmSync(full);
    }
  }
}
```

Append:

```typescript
describe("generateDeclsForDirectory — cross-lib inheritance", () => {
  it("emits import type for a base in another scanned header", () => {
    const root = path.resolve(__dirname, "../../../tests/fixtures/cpp-inheritance");
    cleanDecls(root);
    const created = generateDeclsForDirectory(root, true);
    const dependentDts = path.join(root, "libA", "Dependent.d.ts");
    expect(created).toContain(dependentDts);
    const content = fs.readFileSync(dependentDts, "utf8");
    expect(content).toContain('import type { Base } from "../libB/Base";');
    expect(content).toContain("export declare class Dependent extends Base {");
  });

  it("emits an empty stub for an unresolved base", () => {
    withTempDir((dir) => {
      const h = path.join(dir, "Foo.h");
      fs.writeFileSync(h, "class Foo : public Bar {\npublic:\n  void x();\n};\n", "utf8");
      // Single-file mode has no resolver → Bar is unresolved → stub.
      generateDecl(h);
      const dts = fs.readFileSync(path.join(dir, "Foo.d.ts"), "utf8");
      expect(dts).toContain("declare class Bar {}");
      expect(dts).toContain("export declare class Foo extends Bar {");
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts`
Expected: FAIL — no `import type` emitted; no stub emitted.

- [ ] **Step 3: Add a resolver-aware emitter function**

In `packages/cuttlefish/src/libdef/cpp-to-decl.ts`, add an import at the top (after the existing header-parser import):

```typescript
import { buildClassIndex, BaseClassResolver } from "./base-class-resolver";
```

Append the following function at the end of `cpp-to-decl.ts`:

```typescript

/**
 * Like generateDeclaration, but resolves base classes against `resolver` and
 * the emitting file path (for computing relative import paths).
 *
 * Emission order: imports → constants → stubs → classes.
 */
function generateDeclarationWithResolver(
  parsed: CppParseResult,
  resolver: BaseClassResolver,
  emittingFilePath: string,
): string {
  const lines: string[] = [];
  const importingFrom = new Map<string, string>(); // baseName → POSIX import path
  const stubs = new Set<string>();                  // unresolved base names
  const classNames = new Set(parsed.classes.map(c => c.name));

  // Classify each base.
  for (const cls of parsed.classes) {
    if (!cls.baseClass) continue;
    if (classNames.has(cls.baseClass)) continue; // same-file base
    const r = resolver.resolve(cls.baseClass);
    if (r.kind === "found") {
      const targetDts = r.headerPath.replace(/\.h$/i, ".d.ts");
      const rel = path.relative(path.dirname(emittingFilePath), path.dirname(targetDts));
      const targetBase = path.basename(targetDts, ".d.ts");
      const relPosix = (rel || ".").replace(/\\/g, "/");
      const importPath = relPosix === "." ? `./${targetBase}` : `${relPosix}/${targetBase}`;
      importingFrom.set(cls.baseClass, importPath);
    } else {
      stubs.add(cls.baseClass);
    }
  }

  // Imports.
  for (const [baseName, importPath] of importingFrom) {
    lines.push(`import type { ${baseName} } from "${importPath}";`);
  }
  if (importingFrom.size > 0) lines.push("");

  // Constants.
  for (const constant of parsed.constants) {
    lines.push(`export declare const ${constant.name}: ${constant.type};`);
  }
  if (parsed.constants.length > 0 && parsed.classes.length > 0) lines.push("");

  // Stubs for unresolved bases.
  for (const stub of stubs) {
    lines.push(`declare class ${stub} {}`);
  }
  if (stubs.size > 0) lines.push("");

  // Classes.
  for (const cppClass of parsed.classes) {
    const extendsClause = cppClass.baseClass ? ` extends ${cppClass.baseClass}` : "";
    lines.push(`export declare class ${cppClass.name}${extendsClause} {`);
    for (const ctor of cppClass.constructors) {
      const params = ctor.parameters
        .filter(p => p.name)
        .map(p => `${p.name}: ${p.type}`)
        .join(", ");
      lines.push(`  constructor(${params});`);
    }
    const publicMethods = cppClass.methods.filter(m => m.isPublic);
    for (const method of publicMethods) {
      const params = method.parameters
        .filter(p => p.name)
        .map(p => `${p.name}: ${p.type}`)
        .join(", ");
      lines.push(`  ${method.name}(${params}): ${method.returnType};`);
    }
    lines.push("}");
  }

  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Add a resolver-aware file emitter**

Append the following function right after `generateDeclarationWithResolver`:

```typescript

/**
 * Like generateDecl, but resolves base classes against `resolver`: cross-file
 * bases become `import type`; unresolved bases become empty stubs.
 */
function generateDeclWithResolver(
  filePath: string,
  resolver: BaseClassResolver,
): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  const baseNoExt = path.basename(filePath, ext);

  let headerPath: string | undefined;
  let cppPath: string | undefined;
  if (ext === ".h") {
    headerPath = filePath;
    const siblingCpp = path.join(dir, baseNoExt + ".cpp");
    cppPath = fs.existsSync(siblingCpp) ? siblingCpp : undefined;
  } else if (ext === ".cpp") {
    cppPath = filePath;
    const siblingH = path.join(dir, baseNoExt + ".h");
    headerPath = fs.existsSync(siblingH) ? siblingH : undefined;
  } else {
    return null;
  }

  let headerClasses: ParsedClass[] = [];
  if (headerPath) {
    headerClasses = parseHeader(fs.readFileSync(headerPath, "utf8"));
  }
  let cppResult: CppParseResult = { classes: [], constants: [] };
  if (cppPath) {
    cppResult = parseCppClass(fs.readFileSync(cppPath, "utf8"));
  }

  const merged: CppClass[] = [];
  const byName = new Map<string, CppClass>();
  for (const h of headerClasses) {
    const cls: CppClass = {
      name: h.name,
      methods: [...h.methods],
      constructors: [...h.constructors],
      baseClass: h.baseClass,
      source: "header",
    };
    byName.set(h.name, cls);
    merged.push(cls);
  }
  for (const c of cppResult.classes) {
    const existing = byName.get(c.name);
    if (existing) {
      for (const m of c.methods) {
        if (!existing.methods.some(em => em.name === m.name)) {
          existing.methods.push(m);
        }
      }
    } else {
      merged.push({ ...c, source: "cpp" });
    }
  }

  if (merged.length === 0 && cppResult.constants.length === 0) {
    return null;
  }

  const declaration = generateDeclarationWithResolver(
    { classes: merged, constants: cppResult.constants },
    resolver,
    filePath,
  );

  const outPath = path.join(dir, baseNoExt + ".d.ts");
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, "utf8") !== declaration) {
    fs.writeFileSync(outPath, declaration, "utf8");
  }
  return outPath;
}
```

- [ ] **Step 5: Make single-file `generateDecl` emit stubs too**

The test "emits an empty stub for an unresolved base" calls `generateDecl` (single-file, no resolver) and expects a stub. So `generateDecl` must use an empty resolver so unresolved bases always become stubs. Update `generateDecl`'s final emission block — replace:

```typescript
  const declaration = generateDeclaration({ classes: merged, constants: cppResult.constants });

  const outPath = outputPath || path.join(dir, baseNoExt + ".d.ts");
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, "utf8") !== declaration) {
    fs.writeFileSync(outPath, declaration, "utf8");
  }
  return outPath;
}
```

with:

```typescript
  // Single-file mode: no resolver → all cross-file bases are "external" →
  // emitted as empty stubs so the .d.ts still compiles standalone.
  const declaration = generateDeclarationWithResolver(
    { classes: merged, constants: cppResult.constants },
    new BaseClassResolver(new Map()),
    filePath,
  );

  const outPath = outputPath || path.join(dir, baseNoExt + ".d.ts");
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, "utf8") !== declaration) {
    fs.writeFileSync(outPath, declaration, "utf8");
  }
  return outPath;
}
```

- [ ] **Step 6: Replace `generateDeclsForDirectory` with the resolver-aware version**

In `cpp-to-decl.ts`, replace the entire existing `generateDeclsForDirectory` function with:

```typescript
/**
 * Scans a directory for .h and .cpp files and generates .d.ts files.
 *
 * Two passes:
 *   1. Build a class-name → header-path index from all .h under dir.
 *   2. For each .h (and .cpp with no sibling .h), parse + merge + emit with
 *      cross-file base resolution.
 */
export function generateDeclsForDirectory(dir: string, recursive: boolean = true): string[] {
  const created: string[] = [];
  if (!fs.existsSync(dir)) {
    return created;
  }

  const index = buildClassIndex(dir);
  const resolver = new BaseClassResolver(index);

  const walk = (d: string) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && recursive) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".h")) {
        const r = generateDeclWithResolver(full, resolver);
        if (r) created.push(r);
      } else if (lower.endsWith(".cpp")) {
        // Skip .cpp files that have a sibling .h — the .h drives emission.
        const cppBase = path.basename(full, ".cpp");
        const siblingH = path.join(path.dirname(full), cppBase + ".h");
        if (!fs.existsSync(siblingH)) {
          const r = generateDeclWithResolver(full, resolver);
          if (r) created.push(r);
        }
      }
    }
  };
  walk(dir);
  return created;
}
```

- [ ] **Step 7: Build**

Run: `cd C:/typecad/typecode/packages/cuttlefish && npm run build`
Expected: clean build.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 9: Commit**

```bash
cd C:/typecad/typecode
git add packages/cuttlefish/src/libdef/cpp-to-decl.ts tests/packages/transpiler/gen-decls-inheritance.test.ts
git commit -m "feat(gen-decls): cross-file import type + stub emission for base classes"
```

---

## Task 7: CLI integration — single-file accepts `.h`, `--all` unchanged path

**Files:**
- Modify: `packages/cuttlefish/src/cli.ts`
- Modify: `tests/packages/transpiler/gen-decls-cli.test.ts`

- [ ] **Step 1: Add a failing test for single-file `.h` runtime acceptance**

In `tests/packages/transpiler/gen-decls-cli.test.ts`, add imports at the top:

```typescript
import { generateDecl } from "@typecad/cuttlefish/testing";
import fs from "node:fs";
import os from "node:os";
```

Add `path` to the existing import if not already present (it is — the file already imports `path`).

Append a new describe block:

```typescript
describe("gen-decls single-file .h runtime acceptance", () => {
  it("generateDecl accepts a .h file and produces a .d.ts", () => {
    const tmp = path.join(os.tmpdir(), `gen-decls-cli-${Date.now()}.h`);
    fs.writeFileSync(tmp, "class Foo { public: void bar(); };", "utf8");
    try {
      const out = generateDecl(tmp);
      expect(out).toBeTruthy();
      expect(path.basename(out!)).toBe(path.basename(tmp, ".h") + ".d.ts");
      expect(fs.readFileSync(out!, "utf8")).toContain("export declare class Foo");
    } finally {
      fs.rmSync(tmp, { force: true });
      fs.rmSync(tmp.replace(/\.h$/, ".d.ts"), { force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-cli.test.ts`
Expected: FAIL — `generateDecl` not exported (testing.ts re-export for it is added in Task 5 step 7; if you skipped that, this fails here).

If Task 5 step 7 was done, this test should already pass — in that case skip to Step 4 (the CLI edit) and add a stronger assertion that `.h` is accepted end-to-end via the CLI. The most reliable check is the runtime extension guard in `cli.ts`.

- [ ] **Step 3: Update the single-file branch in `cli.ts`**

In `packages/cuttlefish/src/cli.ts`, replace the single-file gen-decls block:

```typescript
      // Single file mode - C++ input expected
      if (!options.inputFile) {
        throw new Error("Missing input C++ file path. Use: gen-decls <file.cpp> or gen-decls --all <directory>");
      }
      const extension = path.extname(options.inputFile).toLowerCase();
      if (extension !== ".cpp") {
        throw new Error(`gen-decls expects a .cpp file, received '${extension || "<no extension>"}'.`);
      }

      ui.printHeader();
      ui.printStep("Generating declarations...");
      const created = generateDeclFromCpp(options.inputFile);
      if (created) {
        ui.printSuccess(`Created: ${created}`);
      } else {
        ui.printInfo("No declaration file created (no classes or constants found).");
      }
      return;
```

with:

```typescript
      // Single file mode - C++ header or source expected
      if (!options.inputFile) {
        throw new Error("Missing input C++ file path. Use: gen-decls <file.h|file.cpp> or gen-decls --all <directory>");
      }
      const extension = path.extname(options.inputFile).toLowerCase();
      if (extension !== ".cpp" && extension !== ".h") {
        throw new Error(`gen-decls expects a .h or .cpp file, received '${extension || "<no extension>"}'.`);
      }

      ui.printHeader();
      ui.printStep("Generating declarations...");
      const created = generateDecl(options.inputFile);
      if (created) {
        ui.printSuccess(`Created: ${created}`);
      } else {
        ui.printInfo("No declaration file created (no classes or constants found).");
      }
      return;
```

- [ ] **Step 4: Update the `generateDeclFromCpp` import in `cli.ts`**

In `packages/cuttlefish/src/cli.ts` line 10, replace:

```typescript
import { generateDeclFromCpp, generateDeclsForDirectory } from "./libdef/cpp-to-decl";
```

with:

```typescript
import { generateDecl, generateDeclsForDirectory } from "./libdef/cpp-to-decl";
```

- [ ] **Step 5: Build**

Run: `cd C:/typecad/typecode/packages/cuttlefish && npm run build`
Expected: clean build.

- [ ] **Step 6: Run both test suites**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler/gen-decls-inheritance.test.ts tests/packages/transpiler/gen-decls-cli.test.ts`
Expected: PASS (all tests in both files).

- [ ] **Step 7: Commit**

```bash
cd C:/typecad/typecode
git add packages/cuttlefish/src/cli.ts tests/packages/transpiler/gen-decls-cli.test.ts
git commit -m "feat(gen-decls): single-file mode accepts .h; uses generateDecl"
```

---

## Task 8: End-to-end verification against the real Adafruit library

**Files:** none (verification only)

- [ ] **Step 1: Clean stale `.d.ts` in the demo libs**

Run from `C:/typecad/typecode/demo-ui`:

```bash
cd C:/typecad/typecode/demo-ui
# Remove previously generated .d.ts so the scan regenerates fresh:
node -e "const fs=require('fs'),path=require('path');function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())w(f);else if(e.name.endsWith('.d.ts'))fs.rmSync(f)}}w('lib')"
```

- [ ] **Step 2: Run gen-decls across all libs**

Run from `C:/typecad/typecode/demo-ui`:

```bash
cuttlefish gen-decls --all ./lib
```

Expected: prints `Created declaration files:` listing `.d.ts` files across `lib/Adafruit_GFX_Library` and `lib/Adafruit_ILI9341`.

- [ ] **Step 3: Verify inheritance landed in `Adafruit_ILI9341.d.ts`**

Inspect `demo-ui/lib/Adafruit_ILI9341/Adafruit_ILI9341.d.ts`. Confirm:

1. Contains `import type { Adafruit_SPITFT } from "../Adafruit_GFX_Library/Adafruit_SPITFT";`
2. Contains `export declare class Adafruit_ILI9341 extends Adafruit_SPITFT {`

If the import is missing, confirm `lib/Adafruit_GFX_Library/Adafruit_SPITFT.h` is being indexed: `grep -l "class Adafruit_SPITFT" demo-ui/lib/Adafruit_GFX_Library/Adafruit_SPITFT.h` should match.

- [ ] **Step 4: Verify the chain continues to `Adafruit_GFX`**

Inspect `demo-ui/lib/Adafruit_GFX_Library/Adafruit_SPITFT.d.ts`. Confirm:

1. Contains `import type { Adafruit_GFX } from "./Adafruit_GFX";`
2. Contains `export declare class Adafruit_SPITFT extends Adafruit_GFX {`

Inspect `demo-ui/lib/Adafruit_GFX_Library/Adafruit_GFX.d.ts`. Confirm:

1. Contains `declare class Print {}` (stub — `Print` is Arduino core, not scanned)
2. Contains `export declare class Adafruit_GFX extends Print {`
3. Contains the drawing primitives: `fillRect`, `drawRect`, `fillScreen`, `setTextSize`, `setFont`, `drawChar`.

- [ ] **Step 5: Run the full transpiler test suite**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/transpiler`
Expected: PASS — no regressions.

- [ ] **Step 6: Commit regenerated `.d.ts` (optional, separate commit)**

The `demo-ui/lib/` tree is untracked (per the repo's git status). Only commit if you want the generated declarations under version control:

```bash
cd C:/typecad/typecode
git status demo-ui/lib  # confirm what would be added
# If desired:
git add demo-ui/lib/Adafruit_GFX_Library/*.d.ts demo-ui/lib/Adafruit_ILI9341/*.d.ts
git commit -m "chore(demo-ui): regenerate Adafruit .d.ts with inheritance"
```

---

## Self-review

**Spec coverage:**
- Header parsing + `#if` stripping + base class capture → Task 1, 2
- `.h` + sibling `.cpp` merge → Task 5
- Cross-lib resolver, scoped to scan path → Task 3, 4
- `import type` emission + empty stub for unresolved → Task 6
- Single-file mode accepts `.h` → Task 7
- `--all` scans `.h` and `.cpp` → Task 6 (`generateDeclsForDirectory` rewrite)
- End-to-end against real Adafruit libs → Task 8
- Backward compat: `generateDeclFromCpp` kept as a wrapper — **gap**: Task 5 step 6 adds `generateDecl` but does not add the backward-compat wrapper. See fix below.

**Gap fix:** In Task 5, after Step 6 (adding `generateDecl`), add a wrapper so existing imports of `generateDeclFromCpp` keep resolving. Add this to the end of `cpp-to-decl.ts`:

```typescript

/** Backward-compat wrapper for generateDecl — delegates with .cpp semantics. */
export function generateDeclFromCpp(cppFilePath: string, outputPath?: string): string | null {
  return generateDecl(cppFilePath, outputPath);
}
```

(Ensure the existing `generateDeclFromCpp` implementation is removed or renamed to avoid a duplicate-symbol error — the original function at lines ~343-366 should be deleted in favor of this wrapper.)

**Placeholder scan:** No TBD/TODO in any task step. All code blocks are complete.
**Type consistency:** `ParsedClass` fields (`name`, `methods`, `constructors`, `baseClass?`, `source`) match between `header-parser.ts` (definition) and `cpp-to-decl.ts` (consumption). `BaseClassResolver.resolve` returns `ResolveResult` consumed consistently. `generateDecl`/`generateDeclWithResolver` share identical merge logic (intentional duplication for now; a refactor to extract the merge is out of scope).
