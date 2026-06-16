import tsparser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";
import transpilerPlugin from "../eslint-transpiler-rules.mjs";

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
  {
    selector: "TSEnumBody TSEnumMember Literal[raw=/[^0-9.]/]",
    message:
      "[transpiler] String-valued enum members have no C++ equivalent (C++ enums are integer-only). Use integer values or a Map.",
  },
  {
    selector: "VariableDeclaration[kind='var']",
    message:
      "[transpiler] var declarations have no C++ equivalent. Use let or const instead.",
  },
  // A1: generic type aliases (type X = Map<K,V> / Set<T> / (...)=>T) are not
  // emitted as C++ typedefs — the alias name silently disappears and use sites
  // fail with "does not name a type". Inline the concrete generic form instead.
  // `type X = NamedInterface` and `type X = number` still work (no type args).
  {
    selector:
      "TSTypeAliasDeclaration > TSTypeReference[typeParameters]",
    message:
      "[transpiler] Type aliases to generic types (e.g. type X = Map<K,V>, Set<T>) are not emitted as C++ typedefs and vanish at the use site. Inline the concrete generic form (Map<K,V>) at each use site, or use a named interface.",
  },
  {
    selector: "TSTypeAliasDeclaration > TSFunctionType",
    message:
      "[transpiler] Function-type aliases (type Fn = (...) => T) are not emitted as C++ typedefs. Inline the function signature at each use site, or use a named interface with a call signature.",
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
  // §2.6 🟡 — async/await/generators are parse-compatible but cannot produce
  // correct firmware behavior; treat as unsupported to avoid silent surprises.
  {
    selector: "FunctionDeclaration[async=true]",
    message:
      "[transpiler] async functions are recognized for parse-compatibility but cannot produce correct embedded behavior (no event loop). Use a synchronous function.",
  },
  {
    selector: "FunctionExpression[async=true]",
    message:
      "[transpiler] async function expressions are recognized for parse-compatibility but cannot produce correct embedded behavior (no event loop). Use a synchronous function.",
  },
  {
    selector: "ArrowFunctionExpression[async=true]",
    message:
      "[transpiler] async arrow functions are recognized for parse-compatibility but cannot produce correct embedded behavior (no event loop). Use a synchronous arrow function.",
  },
  {
    selector: "AwaitExpression",
    message:
      "[transpiler] await is stripped to an inline expression — semantics are approximate and there is no event loop on bare metal. Avoid in firmware.",
  },
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
  {
    selector: "TSEnumDeclaration[const!=true]",
    message:
      "[transpiler] only 'const enum' is supported. Add the `const` keyword to the enum declaration.",
  },

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
      parserOptions: {
        // Type-aware parsing so @typescript-eslint/no-explicit-any resolves
        // imported bindings to their real types instead of defaulting to any.
        project: "./tsconfig.json",
      },
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
      "cuttlefish/no-undefined-compare-on-struct-field": "error",
      "cuttlefish/no-typed-array-param-length": "error",
      "cuttlefish/no-typed-array-return": "error",
      "cuttlefish/no-dynamic-property-access": "error",
      "cuttlefish/no-this-in-free-function": "error",
    },
  },
];
