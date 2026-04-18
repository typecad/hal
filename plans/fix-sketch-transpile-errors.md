# Fix: `demo/src/sketch.ts` Transpilation Compile Errors

## Problem Summary

Transpiling [`demo/src/sketch.ts`](demo/src/sketch.ts) produces [`demo/src/out/sketch/sketch.ino`](demo/src/out/sketch/sketch.ino) with **6 distinct categories of C++ compile errors**. The root causes span the IR builder, type resolver, Arduino strategy, and expression renderer.

---

## Generated Output vs. Expected

### Current (broken) output:
```cpp
const Uint8Array* calibData = new Uint8Array({ 1, 2, 3, 4 });   // ERROR 1, 2
writeBuffer(136, calibData);                                       // ERROR 3

void configureSensor() {
  Wire.beginTransmission(BME280_ADDR); Wire.write(245); Wire.write({ 160, 39 }); Wire.endTransmission();  // ERROR 4
}

void writeBuffer(int register, int data) {                         // ERROR 5, 6
  Wire.beginTransmission(BME280_ADDR); Wire.write(register); Wire.write(data); Wire.endTransmission();
}
```

### Expected output:
```cpp
uint8_t calibData[] = { 1, 2, 3, 4 };
writeBuffer(136, calibData, sizeof(calibData));

void configureSensor() {
  Wire.beginTransmission(BME280_ADDR);
  Wire.write(245);
  Wire.write(160);
  Wire.write(39);
  Wire.endTransmission();
}

void writeBuffer(int reg, const uint8_t* data, size_t len) {
  Wire.beginTransmission(BME280_ADDR);
  Wire.write(reg);
  Wire.write(data, len);
  Wire.endTransmission();
}
```

---

## Root Cause Analysis

### Error 1: `new Uint8Array(...)` emits as C++ `new Uint8Array(...)`

**File:** [`packages/cli/src/ir/build-ir.ts`](packages/cli/src/ir/build-ir.ts:590)

The `expressionToIR` function handles `ts.isNewExpression` generically — it renders any `new ClassName(args)` as a raw `new ClassName(args)` string. There is no special case for `Uint8Array`.

```typescript
// Line 590-608: Generic new expression handling
if (ts.isNewExpression(expr)) {
    const ctorText = formatExpressionText(expr.expression);
    // ...
    return { kind: "raw", value: `new ${ctorText}(${argsText})` };
}
```

**Fix:** Add a special case before the generic handler. When `ctorText === "Uint8Array"`, extract the array argument and emit an IR node that represents a C++ `uint8_t[]` initializer.

---

### Error 2: `Uint8Array` type not mapped to C++

**File:** [`packages/cli/src/ir/type-resolution.ts`](packages/cli/src/ir/type-resolution.ts:165)

The `typeNodeToCppType` function has no mapping for `Uint8Array`. It falls through to the default `return "auto"`, which then gets normalized to `"int"` — causing the variable declaration to emit as `int` instead of `uint8_t[]`.

**Fix:** Add `Uint8Array` → `uint8_t*` mapping in `typeNodeToCppType`, similar to how `Array` maps to `std::vector<>`.

---

### Error 3: `device.writeBytes` with array literal emits `{ 160, 39 }` as a single `Wire.write()` arg

**File:** [`packages/framework-arduino/src/typecode-map.ts`](packages/framework-arduino/src/typecode-map.ts:334)

The `device.writeBytes` case renders the data argument as a single `Wire.write(data)` call:

```typescript
case 'device.writeBytes': {
    const addr = a(0);
    const register = a(1);
    const data = a(2);
    return `${wire}.beginTransmission(${addr}); ${wire}.write(${register}); ${wire}.write(${data}); ${wire}.endTransmission()`;
}
```

When `data` is an array literal `[0b10100000, 0b00100111]`, it renders as `{ 160, 39 }` — which is not valid C++ inside `Wire.write()`.

**Fix:** When the data argument IR is an `array` kind, expand it into individual `Wire.write(element)` calls. When it is a variable reference, use `Wire.write(data, len)`.

---

### Error 4: `device.writeBytes` with `Uint8Array` variable reference

Same code location as Error 3. When `data` is a `Uint8Array` variable (e.g., `calibData`), the current code emits `Wire.write(calibData)` which is invalid because `Wire.write()` needs a pointer and length.

**Fix:** Track array/Uint8Array variable sizes and emit `Wire.write(data, sizeof(data))` or pass length as an additional parameter.

---

### Error 5: C++ reserved keyword `register` used as parameter name

**File:** [`packages/cli/src/ir/build-ir.ts`](packages/cli/src/ir/build-ir.ts:2795) (and similar parameter extraction locations)

TypeScript function parameters like `register: number` are emitted verbatim in C++. `register` is a C++ storage class keyword, making the output invalid.

```cpp
void writeBuffer(int register, int data)  // ERROR: register is reserved
```

**Fix:** Add a keyword-escaping function that renames C++ reserved words (e.g., `register` → `reg`, `class` → `cls`, `auto` → `autoVal`, etc.) applied when emitting parameter names.

---

### Error 6: `Uint8Array` parameter typed as `int` in C++

**File:** [`packages/cli/src/ir/type-resolution.ts`](packages/cli/src/ir/type-resolution.ts:165)

The `writeBuffer(register: number, data: Uint8Array)` function has its `data` parameter typed as `Uint8Array` in TypeScript. Since `Uint8Array` is not mapped in `typeNodeToCppType`, it resolves to `"auto"` → `"int"`.

```cpp
void writeBuffer(int register, int data)  // data should be uint8_t* or uint8_t[]
```

**Fix:** Same as Error 2 — map `Uint8Array` to `uint8_t*` in the type resolver.

---

## Fix Plan

### Fix 1: Handle `new Uint8Array([...])` in expression-to-IR

**File:** [`packages/cli/src/ir/build-ir.ts`](packages/cli/src/ir/build-ir.ts:590)

Add a special case in the `ts.isNewExpression` block:

```typescript
if (ts.isNewExpression(expr)) {
    const ctorText = formatExpressionText(expr.expression);

    // Special case: new Uint8Array([...]) → C++ uint8_t array initializer
    if (ctorText === "Uint8Array") {
        const args = expr.arguments ?? [];
        if (args.length === 1 && ts.isArrayLiteralExpression(args[0])) {
            const elements = args[0].elements.map(e =>
                renderExprAsText(expressionToIR(e, sourceText, diagnostics, pointerVars))
            );
            return { kind: "uint8_array", elements };
        }
        // new Uint8Array(n) — allocate n bytes
        if (args.length === 1) {
            const size = renderExprAsText(expressionToIR(args[0], sourceText, diagnostics, pointerVars));
            return { kind: "uint8_array_alloc", size };
        }
    }
    // ... existing generic handler
}
```

Also add a corresponding case in the expression renderer ([`packages/cli/src/emit/expression-renderer.ts`](packages/cli/src/emit/expression-renderer.ts)) and statement renderer to emit `uint8_t name[] = { ... }` instead of `const Uint8Array* name = new Uint8Array({ ... })`.

### Fix 2: Map `Uint8Array` type to C++ type

**File:** [`packages/cli/src/ir/type-resolution.ts`](packages/cli/src/ir/type-resolution.ts:32)

Add to `DIRECT_CPP_TYPE_MAP`:
```typescript
["Uint8Array", "uint8_t*"],
```

Or add a dedicated check in `typeNodeToCppType` for `Uint8Array` that returns `"uint8_t*"`.

### Fix 3: Expand array literals in `device.writeBytes`

**File:** [`packages/framework-arduino/src/typecode-map.ts`](packages/framework-arduino/src/typecode-map.ts:334)

Modify the `device.writeBytes` case to inspect the data argument IR kind:

```typescript
case 'device.writeBytes': {
    const addr = a(0);
    const register = a(1);
    const dataArg = args[2];

    if (dataArg?.kind === "array") {
        // Expand array literal into individual Wire.write() calls
        const elements = dataArg.elements.map(e => renderArg(e)).join("; ") ;
        return `${wire}.beginTransmission(${addr}); ${wire}.write(${register}); ${elements}; ${wire}.endTransmission()`;
        // Actually: each element needs Wire.write() wrapping
    }

    // Variable reference — use Wire.write(data, sizeof(data))
    const data = a(2);
    return `${wire}.beginTransmission(${addr}); ${wire}.write(${register}); ${wire}.write(${data}, sizeof(${data})); ${wire}.endTransmission()`;
}
```

**Note:** The `tryRenderTypecodeCall` API receives `args: ReadonlyArray<ExpressionIR>` and `renderArg: (e: ExpressionIR) => string`. The function needs access to the raw IR to branch on `dataArg.kind`. Currently `a(n)` calls `renderArg(args[n])` which loses the kind info. The strategy method signature may need to accept the raw args array alongside the render function.

### Fix 4: Handle `device.writeBytes` with variable references

Same location as Fix 3. For variable references, emit `Wire.write(data, sizeof(data))`. For parameters of `Uint8Array` type, the function signature should include a `size_t len` parameter, and the call site should pass `sizeof(data)`.

This is a more involved change that may require:
- Tracking which variables are arrays/Uint8Array
- Adding a `size_t` parameter to functions that accept `Uint8Array`
- Passing the size at call sites

### Fix 5: Escape C++ reserved keywords in parameter/variable names

**File:** [`packages/cli/src/ir/build-ir.ts`](packages/cli/src/ir/build-ir.ts:2795) and [`packages/cli/src/emit/cpp-emitter.ts`](packages/cli/src/emit/cpp-emitter.ts:1141)

Add a utility function:

```typescript
const CPP_RESERVED = new Set([
    "register", "auto", "class", "struct", "union", "enum",
    "typedef", "template", "typename", "namespace", "using",
    "public", "private", "protected", "virtual", "friend",
    "inline", "explicit", "const_cast", "dynamic_cast",
    "static_cast", "reinterpret_cast", "operator", "delete",
    "new", "this", "throw", "try", "catch", "sizeof",
    "return", "goto", "break", "continue", "switch", "case",
    "default", "if", "else", "for", "while", "do",
    "signed", "unsigned", "short", "long", "void", "static",
    "extern", "mutable", "volatile", "register", "thread_local",
    "constexpr", "constinit", "consteval", "co_await", "co_yield",
    "co_return", "concept", "requires", "static_assert",
]);

function escapeCppKeyword(name: string): string {
    if (CPP_RESERVED.has(name)) return `${name}_`;
    return name;
}
```

Apply in parameter extraction loops and variable declaration emission.

### Fix 6: Handle `.length` on arrays

**File:** [`packages/cli/src/ir/build-ir.ts`](packages/cli/src/ir/build-ir.ts) — property access handling

When the transpiler encounters `values.length` where `values` is an array or `Uint8Array`, it should emit `sizeof(values)/sizeof(values[0])` for C arrays or track the size. For the `writeWithTracking` function in the sketch, `values.length` on a `number[]` parameter should work if the parameter is mapped to a C++ array with a companion size parameter.

---

## Affected Files Summary

| File | Changes |
|------|---------|
| [`packages/cli/src/ir/build-ir.ts`](packages/cli/src/ir/build-ir.ts) | Add `Uint8Array` new-expression handling; add keyword escaping for parameter names |
| [`packages/cli/src/ir/type-resolution.ts`](packages/cli/src/ir/type-resolution.ts) | Map `Uint8Array` → `uint8_t*` in type system |
| [`packages/framework-arduino/src/typecode-map.ts`](packages/framework-arduino/src/typecode-map.ts) | Expand array literals in `device.writeBytes`; handle variable refs with size |
| [`packages/cli/src/emit/expression-renderer.ts`](packages/cli/src/emit/expression-renderer.ts) | Add render case for `uint8_array` IR node |
| [`packages/cli/src/emit/statement-renderer.ts`](packages/cli/src/emit/statement-renderer.ts) | Add declaration rendering for `uint8_array` initializer |
| [`packages/cli/src/emit/cpp-emitter.ts`](packages/cli/src/emit/cpp-emitter.ts) | Apply keyword escaping in parameter emission |
| [`tests/hal-i2c.test.ts`](tests/hal-i2c.test.ts) | Add test cases for multi-byte write with array literals, Uint8Array, and reserved keyword params |

---

## Recommended Implementation Order

1. **Fix 5** — Keyword escaping (smallest, most isolated change)
2. **Fix 2** — `Uint8Array` type mapping (enables other fixes)
3. **Fix 1** — `new Uint8Array([...])` expression handling
4. **Fix 3** — Array literal expansion in `device.writeBytes`
5. **Fix 4** — Variable reference handling in `device.writeBytes`
6. **Fix 6** — `.length` property on arrays
7. **Tests** — Add comprehensive test coverage
8. **Verification** — Re-transpile `demo/src/sketch.ts` and confirm clean output
