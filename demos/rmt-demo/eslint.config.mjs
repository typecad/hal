import tsparser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";
import transpilerPlugin from "../../eslint-transpiler-rules.mjs";

const transpilerRules = [
  {
    selector: "TaggedTemplateExpression",
    message:
      "[transpiler] Tagged template expressions have no C++ equivalent. Use regular template literals or string concatenation.",
  },
  {
    selector: "MetaProperty",
    message:
      "[transpiler] import.meta and new.target have no C++ equivalent.",
  },
  // Regex literals are approximated with std::regex in C++ — JS RegExp
  // syntax/perf do not carry over. (Sourced from feature-registry LINT_RULES.)
  {
    selector: "Literal[regex]",
    message:
      "[transpiler] regex literals are approximated with std::regex in C++ — JS RegExp syntax/perf do not carry over.",
  },
  // A3: computed property keys in object literals ({ [expr]: value }) have no
  // C++ equivalent — the SUPPORT_MATRIX marks them as "no C++ equivalent", and
  // combined with Record<K,V> they lower to a malformed struct. Use fixed
  // property names or a Map<string, T>.
  {
    selector: "ObjectExpression > Property[computed=true]",
    message:
      "[transpiler] Computed property names ({ [expr]: value }) have no C++ equivalent. Use fixed property names, or a Map<string, T> with .set().",
  },

  // ────────────────────────────────────────────────────────────────────────
  // Matrix-derived selectors. Each rule below maps a SUPPORT_MATRIX ❌
  // ("unsupported by design") or 🚫 ("never") row to an AST selector, so the
  // pattern is rejected at lint time instead of emitting broken C++ or an
  // `TS2CPP_UNSUPPORTED_*` placeholder. These are sourced from the matrix's
  // explicit "never" themes (§7) and the per-section ❌/🚫 rows.
  // ────────────────────────────────────────────────────────────────────────

  // §1.2 🚫 — bigint has no C++ equivalent that fits embedded semantics.
  {
    selector: "TSBigIntKeyword",
    message:
      "[transpiler] bigint is not supported (no C++ equivalent for embedded targets). Use number with an explicit fixed-width type (int32_t/int64_t).",
  },
  // §1.2 🚫 — BigInt literals (123n) have the same lack of lowering as the type.
  {
    selector: "Literal[bigInt=true]",
    message:
      "[transpiler] BigInt literals are not supported (no C++ equivalent for embedded targets). Use a number literal with an explicit fixed-width type.",
  },
  // §1.12 🚫 — `never` has no meaningful C++ lowering.
  {
    selector: "TSNeverKeyword",
    message:
      "[transpiler] the `never` type has no meaningful C++ lowering. Avoid it.",
  },
  // §2.2 ❌ — for await...of needs async machinery absent on bare metal.
  {
    selector: "ForOfStatement[await=true]",
    message:
      "[transpiler] for await...of is unsupported (requires an async runtime absent on bare metal). Use a synchronous for...of loop.",
  },
  // §3.4 ❌ — IIFE ((function(){...})() / (() => {...})()) emits the literal
  // `function` keyword into C++ (no inlining path). Assign to a const or use a
  // named top-level function instead.
  {
    selector: "CallExpression[callee.type='FunctionExpression']",
    message:
      "[transpiler] immediately-invoked function expressions (IIFEs) are not supported — the body is not inlined and the `function` keyword is emitted verbatim. Assign to a const or define a named top-level function.",
  },
  {
    selector: "CallExpression[callee.type='ArrowFunctionExpression']",
    message:
      "[transpiler] immediately-invoked arrow expressions (() => {...})() are not supported — the body is not inlined. Assign to a const or define a named top-level function.",
  },
  // §4.7 ❌ — namespace declarations are not supported (no ModuleDeclaration
  // lowering). Use a class with static methods or a module-level grouping.
  // §1.5 ❌ — object spread { ...a, b } has no C++ aggregate equivalent (structs
  // have fixed shape; spreading is dynamic). Construct field-by-field instead.
  {
    selector: "ObjectExpression > SpreadElement",
    message:
      "[transpiler] object spread ({ ...obj }) is not supported — C++ structs have fixed shape. Construct the object field-by-field instead.",
  },
  // §1.6 ❌ — keyof T / indexed access T[K] are type-level operators with no
  // C++ equivalent. Use a plain string + a switch.
  {
    selector: "TSTypeOperator[type='keyof']",
    message:
      "[transpiler] the keyof operator is not supported (no C++ equivalent). Use a string union or a switch over field names.",
  },
  {
    selector: "TSIndexedAccessType",
    message:
      "[transpiler] indexed access types (T[K]) are not supported (no C++ equivalent). Use the concrete field type directly.",
  },
  // §1.6 ❌ — conditional types leak generic T into generated code.
  {
    selector: "TSTypeAliasDeclaration > TSConditionalType",
    message:
      "[transpiler] conditional types (T extends X ? A : B) are not supported — they leak generic type parameters into generated C++. Use an explicit type or a function with overloads.",
  },
  // §1.6 ❌ — mapped types leak generic T.
  {
    selector: "TSTypeAliasDeclaration > TSMappedType",
    message:
      "[transpiler] mapped types ({ [K in keyof T]: U }) are not supported — they leak generic type parameters into generated C++. Construct the type explicitly.",
  },
  // §1.6 ❌ — template literal types have no C++ equivalent.
  {
    selector: "TSTemplateLiteralType",
    message:
      "[transpiler] template literal types have no C++ equivalent. Use a string union or an explicit enum.",
  },
  // §1.7 ❌ — ReturnType/Parameters use typeof-in-type-position (broken).
  {
    selector:
      "TSTypeReference > Identifier[name=/^(ReturnType|Parameters|InstanceType|ConstructorParameters|Extract|Exclude)$/]",
    message:
      "[transpiler] ReturnType/Parameters/InstanceType/Extract/Exclude utility types fall back to auto and are not deterministic enough for C++ emission. Declare the concrete type explicitly.",
  },
  // §4.1 ❌ — static initializer block has no C++ lowering (C++ uses static
  // field initializers, not a code block). Initialize in the field declaration.
  {
    selector: "StaticBlock",
    message:
      "[transpiler] static initializer blocks (static { ... }) are not supported. Initialize static fields in their declaration or the constructor.",
  },
  // §2.6 🚫 — Promise / .then need a promise runtime. (Await/async are
  // approximated but flagged separately below.)
  {
    selector: "Identifier[name='Promise']",
    message:
      "[transpiler] Promise is not supported (no promise runtime on bare metal). Use synchronous return values or callbacks.",
  },
  {
    selector: "CallExpression > MemberExpression.callee[property.name='then']",
    message:
      "[transpiler] .then() on a Promise is not supported (no promise runtime). Use synchronous return values or callbacks.",
  },
  // §2.6 — async/await ARE supported: each `async function` lowers to a
  // cooperative state-machine task driven from loop() (see
  // emit/utils/async-state-machine.ts + the async-runtime microtask pump),
  // and `await` lowers to the task yielding between segments. Generators and
  // `for await...of` still have no lowering and remain flagged.
  {
    selector: "FunctionDeclaration[generator=true]",
    message:
      "[transpiler] generator functions (function*) have no coroutine runtime on bare metal and are effectively unusable. Avoid.",
  },
  {
    selector: "FunctionExpression[generator=true]",
    message:
      "[transpiler] generator expressions (function*) have no coroutine runtime on bare metal and are effectively unusable. Avoid.",
  },
  {
    selector: "YieldExpression",
    message:
      "[transpiler] yield lowers to co_yield but no coroutine runtime is wired for embedded targets. Avoid.",
  },
  // §5.1 🟡 — ** exponentiation is not a first-class emit (may need pow()).
  {
    selector: "BinaryExpression[operator='**']",
    message:
      "[transpiler] the ** exponentiation operator is not a first-class emit. Use Math.pow() for reliable lowering.",
  },
  // §5.4 ❌ — JSON.* has no JSON runtime on bare metal.
  {
    selector: "MemberExpression[object.name='JSON']",
    message:
      "[transpiler] JSON.* is not supported (no JSON runtime on bare metal). Parse/format manually, or avoid.",
  },
  // §5.4 ❌ — String.* statics (fromCharCode/fromCodePoint/raw) have no C++
  // lowering and no JS string runtime on bare metal. Build the string from an
  // explicit single-char-string lookup table instead. (Demo #28 Finding A.)
  {
    selector:
      "CallExpression > MemberExpression.callee[object.name='String'][property.name=/^(fromCharCode|fromCodePoint|raw)$/] | MemberExpression[object.name='String']",
    message:
      "[transpiler] String.* static methods (fromCharCode, fromCodePoint, raw, ...) are not lowered to C++. Build the string from an explicit single-char-string lookup table instead.",
  },
  // §5.4 ❌ — Number.* statics have no JS number runtime on bare metal.
  {
    selector:
      "CallExpression > MemberExpression.callee[object.name='Number'][property.name=/^(parseInt|parseFloat|isFinite|isNaN|isInteger|isSafeInteger)$/]",
    message:
      "[transpiler] Number.* static methods are not lowered to C++ (no JS number-runtime on bare metal). Use an explicit cast or a fixed-width numeric type.",
  },
  // §5.4 ❌ — Array.from / Array.of have no JS array runtime on bare metal.
  // (Array.isArray IS supported — a compile-time type check.)
  {
    selector:
      "CallExpression > MemberExpression.callee[object.name='Array'][property.name=/^(from|of)$/]",
    message:
      "[transpiler] Array.from / Array.of are not lowered to C++ (no JS array runtime). Construct the std::vector directly (a literal, a sized loop, or std::vector<...>). Array.isArray IS supported.",
  },
  // §5.4 ❌ — new Date() has no Date/calendar runtime on bare metal.
  {
    selector: "NewExpression[callee.name='Date']",
    message:
      "[transpiler] new Date() is not supported — no Date/calendar runtime on bare metal. Use millis()/micros() for elapsed time or pass an explicit value.",
  },
  // §5.4 ❌ — Object.assign / Object.freeze / Object.fromEntries are not lowered.
  {
    selector:
      "CallExpression > MemberExpression.callee[object.name='Object'][property.name=/^(assign|freeze|fromEntries)$/]",
    message:
      "[transpiler] Object.assign/freeze/fromEntries are not lowered to C++. Construct objects explicitly or use a Map.",
  },
  // §6.2 ❌ — dynamic import() has no runtime loader on bare metal.
  {
    selector: "ImportExpression",
    message:
      "[transpiler] dynamic import() is unsupported (no runtime loader on bare metal). Use a static top-level import.",
  },
  // §6.2 ❌ — require() is unsupported.
  {
    selector: "CallExpression[callee.name='require']",
    message:
      "[transpiler] require() is unsupported. Use ES `import`.",
  },
  // §7 never — eval is also enforced by the core `no-eval` builtin below
  // (which additionally catches indirect `eval`), so no selector is needed here.
  // §1.10 🟡 — instanceof across user hierarchies has no RTTI lowering; treat
  // as approximate so users don't rely on it for dispatch.
  {
    selector: "BinaryExpression[operator='instanceof']",
    message:
      "[transpiler] instanceof has no RTTI lowering and is treated loosely. Avoid it for user-class hierarchies in firmware.",
  },
  // Only `const enum` is supported — non-const enums don't get the inlining
  // optimization and behave less reliably across the TS→C++ boundary.

  // ────────────────────────────────────────────────────────────────────────
  // Runtime / dynamic-shape patterns. These depend on JS runtime facilities
  // (reflection, prototype chains, this-rebinding, dynamic code generation)
  // that an AOT C++ lowering cannot model. Sourced from SUPPORT_MATRIX §7
  // "never" themes (RTTI, JS runtime, dynamic shape).
  // ────────────────────────────────────────────────────────────────────────

  // Object.defineProperty/defineProperties/create/getPrototypeOf/setPrototypeOf/
  // getOwnPropertyDescriptor — runtime shape mutation / prototype introspection.
  // Plain structs have a fixed shape at emit time; these APIs have no lowering.
  {
    selector:
      "CallExpression > MemberExpression.callee[object.name='Object'][property.name=/^(defineProperty|defineProperties|create|getPrototypeOf|setPrototypeOf|getOwnPropertyDescriptor)$/]",
    message:
      "[transpiler] Object.defineProperty/defineProperties/create/getPrototypeOf/setPrototypeOf/getOwnPropertyDescriptor mutate or introspect object shape at runtime — no AOT C++ lowering. Avoid.",
  },
  // .bind/.call/.apply — rebind `this` at call time. The transpiler models
  // `this` as a fixed C++ this-> pointer (§4.2); rebinding has no lowering.
  {
    selector:
      "CallExpression > MemberExpression.callee[property.name=/^(bind|call|apply)$/]",
    message:
      "[transpiler] .bind/.call/.apply rebind `this` at call time, which has no C++ lowering (this is a fixed pointer). Call the function/method directly.",
  },
  // new Function(...) — compiles a string into a function at runtime. Same
  // family as eval (§7 "needs a JS runtime").
  {
    selector: "NewExpression[callee.name='Function']",
    message:
      "[transpiler] new Function() compiles a string at runtime — no JS runtime on bare metal. Define a named function instead.",
  },
  // __proto__ assignment — mutates the prototype chain at runtime.
  {
    selector:
      "AssignmentExpression[left.type='MemberExpression'][left.property.name='__proto__']",
    message:
      "[transpiler] __proto__ assignment mutates the prototype chain — no AOT C++ lowering. Use a class with extends, or a Map.",
  },
];

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts", "out/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      // NOTE: do NOT set parserOptions.project here. None of the rules below
      // (no-restricted-syntax, the cuttlefish/* AST rules, no-explicit-any,
      // no-eval, ...) consume type information, so enabling type-aware linting
      // only forces ESLint to build a full TS type-program per file — ~3.4s of
      // pure overhead on small projects with zero change to what is detected.
      // If a future rule needs types, scope project to that rule only via
      // parserOptions on a dedicated config block, not globally.
    },
    plugins: {
      "@typescript-eslint": tseslint,
      cuttlefish: transpilerPlugin,
    },
    rules: {
      "no-restricted-syntax": ["error", ...transpilerRules],
      // Core ESLint + @typescript-eslint rules that enforce AOT-safe code.
      // These patterns either have no C++ lowering or produce unreliable
      // output; reject them at lint time.
      "@typescript-eslint/no-explicit-any": "error",
      "no-delete-var": "error",
      "no-eval": "error",
      "no-sparse-arrays": "error",
      "no-restricted-globals": [
        "error",
        { "name": "Proxy", "message": "[transpiler] Proxy is not supported (no AOT lowering). Avoid." },
        { "name": "Reflect", "message": "[transpiler] Reflect is not supported (no AOT lowering). Avoid." },
        { "name": "WeakRef", "message": "[transpiler] WeakRef depends on the GC schedule — bare metal has no GC. Avoid." },
        { "name": "FinalizationRegistry", "message": "[transpiler] FinalizationRegistry depends on the GC schedule — bare metal has no GC. Avoid." },
        { "name": "Symbol", "message": "[transpiler] Symbol depends on runtime symbol lookup / the iterator protocol, which has no AOT lowering. Avoid." },
      ],
      "cuttlefish/no-delete-non-map": "error",
      "cuttlefish/no-object-static-non-map": "error",
      "cuttlefish/no-super-outside-method": "error",
      "cuttlefish/no-typeof-non-primitive": "error",
      "cuttlefish/no-destructured-without-init": "error",
      "cuttlefish/no-fractional-to-number-type": "error",
      "cuttlefish/no-array-param-content-mutation": "error",
      "cuttlefish/no-container-functional-methods": "error",
      "cuttlefish/no-undefined-compare-on-get": "error",
      "cuttlefish/no-map-struct-mutation": "error",
      "cuttlefish/no-mutating-method-on-const-collection": "warn",
      "cuttlefish/no-readonly-loop-variable-mutation": "warn",
      "cuttlefish/no-undefined-compare-on-struct-field": "error",
      "cuttlefish/no-typed-array-param-length": "error",
      "cuttlefish/no-typed-array-return": "error",
      "cuttlefish/no-typed-array-field": "error",
      "cuttlefish/no-dynamic-property-access": "error",
      "cuttlefish/no-this-in-free-function": "error",
    },
  },
];
