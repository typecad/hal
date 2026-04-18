# Transpiler Pipeline: Missing Type & Feature Support

## Overview

7 gaps identified in the transpiler pipeline that produce invalid or incorrect C++ output.
All changes are localized to 3 files in `packages/cli/src/ir/` plus test additions.

---

## Feature 1: Generalize `new` expression handler for all typed arrays

**Problem:** Only `new Uint8Array([...])` has special-case handling in `expressionToIR`.
The other 5 integer typed arrays (`Int8Array`, `Uint16Array`, `Int16Array`, `Uint32Array`, `Int32Array`)
fall through to the generic handler which emits `new Int16Array(100, 200, 300)` — invalid C++.

**File:** `packages/cli/src/ir/build-ir.ts` (line 593-610)

**Fix:** Replace the `if (ctorText === "Uint8Array")` check with a lookup into a
`TYPED_ARRAY_ELEMENT_MAP` that maps constructor names to their C++ element types:

```typescript
const TYPED_ARRAY_ELEMENT_MAP: Record<string, string> = {
  Uint8Array:  "uint8_t",
  Int8Array:   "int8_t",
  Uint16Array: "uint16_t",
  Int16Array:  "int16_t",
  Uint32Array: "uint32_t",
  Int32Array:  "int32_t",
  Float32Array: "float",    // from Feature 2
  Float64Array: "double",   // from Feature 2
};

// In expressionToIR, new-expression handler:
const elementType = TYPED_ARRAY_ELEMENT_MAP[ctorText];
if (elementType) {
  const args = expr.arguments ?? [];
  if (args.length === 1 && ts.isArrayLiteralExpression(args[0])) {
    const elements = args[0].elements.map(e =>
      expressionToIR(e, sourceText, diagnostics, pointerVars)
    );
    return { kind: "array", elements, elementType } as any;
  }
  if (args.length === 1) {
    const size = renderExprAsText(expressionToIR(args[0], sourceText, diagnostics, pointerVars));
    return { kind: "raw", value: `${elementType}[${size}]` };
  }
}
```

Also update `TYPED_ARRAY_CTORS` in `collectPointerVars` to use the same map's keys.

---

## Feature 2: Add Float32Array / Float64Array support

**Problem:** These are absent from `DIRECT_CPP_TYPE_MAP`, `TYPED_ARRAY_CTORS`, and the
`new` expression handler. Any use produces `auto` type and `new Float32Array(...)` — invalid C++.

**Files:**
- `packages/cli/src/ir/type-resolution.ts` — add to `DIRECT_CPP_TYPE_MAP`
- `packages/cli/src/ir/build-ir.ts` — already covered by Feature 1's `TYPED_ARRAY_ELEMENT_MAP`

**Fix in type-resolution.ts:**
```typescript
// Add to DIRECT_CPP_TYPE_MAP:
["Float32Array", "float*"],
["Float64Array", "double*"],
```

**Fix in build-ir.ts:** Feature 1's `TYPED_ARRAY_ELEMENT_MAP` already includes these.
Also add them to `TYPED_ARRAY_CTORS` in `collectPointerVars`.

---

## Feature 3: Fix `inferExprCppType` for `new TypedArray(...)`

**Problem:** `inferExprCppType` at line 422 returns `${expr.expression.text}*` for any
`new` expression. For `new Uint8Array([1,2,3])` this produces `Uint8Array*` instead of
the correct `uint8_t*` (or better, the C array type).

**File:** `packages/cli/src/ir/type-resolution.ts` (line 422-427)

**Fix:** Look up the constructor name in `DIRECT_CPP_TYPE_MAP` before falling back to
the generic `TypeName*` pattern:

```typescript
if (ts.isNewExpression(expr)) {
  if (ts.isIdentifier(expr.expression)) {
    const ctorName = expr.expression.text;
    // Check if it's a typed array with a known C++ mapping
    const directType = getDirectCppType(ctorName);
    if (directType) {
      return directType;  // e.g. "uint8_t*" for Uint8Array
    }
    return `${ctorName}*`;
  }
  return "auto";
}
```

Note: `getDirectCppType` is a module-local function, so this works within the same file.

---

## Feature 4: Add optional chaining `?.` support

**Problem:** Optional chaining (`sensor?.read()`, `data?.length`) has no explicit handling.
The TypeScript compiler API represents `a?.b` as a `PropertyAccessExpression` with an
optional chain flag. The current code already processes these as regular property access
(because `ts.isPropertyAccessExpression` returns true for optional chains too), so the
access itself works — but the null-safety semantics are silently dropped.

**File:** `packages/cli/src/ir/build-ir.ts`

**Fix:** Two parts:

1. In `expressionToIR`, detect optional chain nodes and emit a diagnostic warning:
   ```typescript
   // At the start of property-access handling (around line 680):
   if (ts.isPropertyAccessExpression(expr)) {
     // Warn about optional chaining — null check is dropped in C++
     if ((expr as any).questionDotToken || ts.isOptionalChain(expr)) {
       diagnostics.push(makeDiagnostic(
         sourceText, expr.pos,
         "Optional chaining (?.) is not supported in C++. The null check will be dropped.",
         "warning", "TS2CPP_OPTIONAL_CHAINING"
       ));
     }
     // ... existing property access handling continues
   }
   ```

2. For optional call chains (`a?.b()`), `ts.isCallExpression` returns true but the
   expression is wrapped. Check `ts.isOptionalChain(expr)` at the start of call
   expression handling and emit the same warning.

Note: `ts.isOptionalChain` is available in TypeScript 4.x+ compiler API.

---

## Feature 5: Add nullish coalescing `??` support

**Problem:** `a ?? b` is a binary expression with `QuestionQuestionToken` operator.
The current binary expression handler passes it through as `a ?? b` — invalid C++.

**File:** `packages/cli/src/ir/build-ir.ts` (line 183-194)

**Fix:** Before the generic binary expression handler, detect `??` and convert to a
ternary expression:

```typescript
// Before the generic binary expression handler:
if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
  const left = expressionToIR(expr.left, sourceText, diagnostics, pointerVars);
  const right = expressionToIR(expr.right, sourceText, diagnostics, pointerVars);
  // a ?? b  →  (a) ? (a) : (b)
  // Note: this evaluates `a` twice, which is acceptable for simple identifiers
  // and literals (the common case in embedded code).
  return {
    kind: "ternary",
    condition: left,
    whenTrue: left,
    whenFalse: right,
  };
}
```

Also handle in `formatExpressionText` (line 97):
```typescript
if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
  const left = formatExpressionText(node.left);
  const right = formatExpressionText(node.right);
  return `(${left} ? ${left} : ${right})`;
}
```

---

## Feature 6: Track function-level typed array vars for `.length` → `sizeof`

**Problem:** `activeCArrayVars` is only populated by `collectPointerVars` which scans
top-level statements. Typed array variables declared inside function bodies are not
tracked, so `buf.length` inside a function emits `buf.size()` instead of `sizeof(buf)`.

**File:** `packages/cli/src/ir/build-ir.ts`

**Fix:** In `variableStatementToIR`, when processing a declaration with a typed array
initializer, add the variable name to `activeCArrayVars`:

```typescript
// In variableStatementToIR, after determining the declaration type (around line 2130):
// Track typed array variables for .length → sizeof handling
if (declaration.initializer && ts.isNewExpression(declaration.initializer)) {
  const ctorText = declaration.initializer.expression &&
    ts.isIdentifier(declaration.initializer.expression)
      ? declaration.initializer.expression.text : "";
  if (TYPED_ARRAY_ELEMENT_MAP[ctorText] && ts.isIdentifier(declaration.name)) {
    activeCArrayVars.add(declaration.name.text);
  }
}
```

This requires moving `TYPED_ARRAY_ELEMENT_MAP` to module scope (or exporting it from
a shared location) so it's accessible in both `expressionToIR` and `variableStatementToIR`.

---

## Feature 7: Add ReadonlyArray / ReadonlyMap / ReadonlySet type mappings

**Problem:** These TypeScript utility types have no handling in `typeNodeToCppType`.
They fall through to `"auto"`, which may produce incorrect type inference.

**File:** `packages/cli/src/ir/type-resolution.ts` (line 233-253)

**Fix:** Add handlers adjacent to the existing `Array`, `Map`, `Set` handlers:

```typescript
// After the "Array" handler (line 195-199):
if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "ReadonlyArray") {
  const elementTypeNode = resolvedNode.typeArguments?.[0];
  const elementType = normalizeTypeHintForUse(typeNodeToCppType(elementTypeNode, typeAliases));
  return `std::vector<${elementType}>`;
}

// After the "Set" handler (line 233-237):
if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "ReadonlySet") {
  const elementTypeNode = resolvedNode.typeArguments?.[0];
  const elementType = normalizeTypeHintForUse(typeNodeToCppType(elementTypeNode, typeAliases));
  return `std::set<${elementType}>`;
}

// After the "Map" handler (line 239-245):
if (ts.isTypeReferenceNode(resolvedNode) && ts.isIdentifier(resolvedNode.typeName) && resolvedNode.typeName.text === "ReadonlyMap") {
  const keyTypeNode = resolvedNode.typeArguments?.[0];
  const valueTypeNode = resolvedNode.typeArguments?.[1];
  const keyType = normalizeTypeHintForUse(typeNodeToCppType(keyTypeNode, typeAliases));
  const valueType = normalizeTypeHintForUse(typeNodeToCppType(valueTypeNode, typeAliases));
  return `std::map<${keyType}, ${valueType}>`;
}
```

---

## Implementation Order

The features should be implemented in this order due to dependencies:

1. **Feature 1 + 2** (together) — Create `TYPED_ARRAY_ELEMENT_MAP`, generalize `new` handler,
   add Float32/64 to type map and ctor map
2. **Feature 3** — Fix `inferExprCppType` using the existing `getDirectCppType`
3. **Feature 7** — Add ReadonlyArray/Map/Set (independent, simple)
4. **Feature 5** — Add `??` → ternary conversion
5. **Feature 4** — Add optional chaining diagnostic
6. **Feature 6** — Track function-level typed array vars (depends on Feature 1's map being module-level)

## Files Changed

| File | Features |
|------|----------|
| `packages/cli/src/ir/build-ir.ts` | 1, 2, 4, 5, 6 |
| `packages/cli/src/ir/type-resolution.ts` | 2, 3, 7 |
| `tests/hal-i2c.test.ts` or new test file | All |

## Tests to Add

One test per feature minimum:

1. `new Int16Array([...])` emits `int16_t arr[] = { ... }`
2. `new Float32Array([1.0, 2.0])` emits `float arr[] = { 1, 2 }`
3. `const x = new Uint8Array([1])` without explicit type annotation infers correctly
4. `sensor?.value` emits diagnostic warning and `sensor.value`
5. `const x = a ?? 0` emits `(a ? a : 0)`
6. Typed array var inside function: `.length` → `sizeof`
7. `ReadonlyArray<number>` parameter type → `std::vector<int>`
