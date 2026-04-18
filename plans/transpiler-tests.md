# Transpiler Functionality Tests Plan

## Goal
Add progressive TypeScript functionality tests to [`demo/src/sketch.ts`](demo/src/sketch.ts) using the fluent `describe/it/expect` chaining API from [`@typecode/expect`](packages/expect/README.md). Tests exercise the TypeCode transpiler by running on real Arduino Uno hardware.

## Current State
The existing tests cover: basic math (+, -, *), variable assignment, function calls with return values, default parameters, typed array indexing, object literals, and destructuring with defaults.

## Test Additions — Simple → Advanced

### Tier 1: Arithmetic Operators
Add variables and a new `describe` block:
- **Division**: `10 / 3` → `3` (integer division on AVR)
- **Modulo**: `10 % 3` → `1`
- **Compound assignment**: `+=`, `-=`, `*=`
- **Increment/decrement**: `++`, `--`
- **Unary negation**: `-x`

### Tier 2: Comparison & Logical Operators
- **Greater than / less than**: results of `>` and `<` as booleans cast to number (0 or 1)
- **Equality/inequality**: `===`, `!==`
- **Logical AND/OR**: `&&`, `||`
- **Logical NOT**: `!`
- **Ternary operator**: `condition ? a : b`

### Tier 3: Bitwise Operators
- **AND**: `a & b`
- **OR**: `a | b`
- **XOR**: `a ^ b`
- **Left shift**: `a << n`
- **Right shift**: `a >> n`
- **Bitwise NOT**: `~a`

### Tier 4: Control Flow
- **if/else branching**: function that returns different values based on condition
- **for loop accumulation**: sum 1..5 using a for loop
- **while loop**: count iterations
- **switch statement**: function returning different values per case

### Tier 5: Enums
- **Numeric enum values**: access enum member values
- **Enum comparison**: compare enum members
- **Enum in function**: function returning enum type

### Tier 6: Boolean Operations
- **Boolean variables**: `true` / `false` as numbers (1 / 0)
- **Boolean expressions**: results of comparisons
- **Truthy/falsy matchers**: `.toBeTruthy()`, `.toBeFalsy()`

### Tier 7: String Operations
- **String concatenation**: `"hello" + " " + "world"`
- **String length**: `.expectString(s).toHaveLength(n)`
- **String equality**: `.expectString(s).toBe(expected)`

### Tier 8: Math Built-ins
- **Math.abs**: absolute value
- **Math.max / Math.min**: already partially tested via clamp, test directly
- **Math.pow**: power function (if supported)

### Tier 9: Classes
- **Basic class**: constructor, instance method, property access
- **Class method returning value**: call method and assert result

### Tier 10: Advanced Functions
- **Functions calling functions**: composition
- **Arrow functions**: `const fn = (x) => x * x` style
- **Recursive function**: factorial with limited depth (e.g., factorial(5))

### Tier 11: Array Iteration
- **for-of loop**: iterate and accumulate
- **Array destructuring**: `const [a, b, c] = arr`

## Available Numeric Matchers
From [`packages/expect/src/types.ts`](packages/expect/src/types.ts):
- `.toBe(n)`, `.toNotBe(n)`, `.toBeTruthy()`, `.toBeFalsy()`
- `.toBeGreaterThan(n)`, `.toBeGreaterThanOrEqual(n)`
- `.toBeLessThan(n)`, `.toBeLessThanOrEqual(n)`
- `.toBeCloseTo(n, precision)`, `.toBeWithinRange(min, max)`

## Available String Matchers
- `.toBe(s)`, `.toNotBe(s)`, `.toContain(sub)`, `.toHaveLength(n)`

## Constraints
- No arrow function callbacks (fluent chaining only)
- `.expect()` takes numeric expressions only
- `.expectString()` for string expressions
- All code must be valid TypeScript
- If a test fails on hardware, notate it and move on — do not attempt to fix transpiler bugs

## Implementation Approach
All new variables, functions, enums, and classes will be declared at the top of [`demo/src/sketch.ts`](demo/src/sketch.ts) (before the existing `describe` blocks), and new `describe` blocks will be appended after the existing ones but before `done()`.
