import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import transpilerPlugin from "./eslint-transpiler-rules.mjs";

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
    selector: "ObjectExpression > SpreadElement",
    message:
      "[transpiler] Object spread has no C++ equivalent. Manually copy properties or use Map.",
  },
  {
    selector: "Property[computed=true]",
    message:
      "[transpiler] Computed property names have no C++ equivalent. Use fixed property names or Map<string, T>.",
  },
  {
    selector: "ChainExpression",
    message:
      "[transpiler] Optional chaining is approximated with a null guard. Use explicit null checks.",
  },
  {
    selector: "LogicalExpression[operator='??']",
    message:
      "[transpiler] Nullish coalescing is approximated. Use explicit null checks.",
  },
  {
    selector: "UnaryExpression[operator='void']",
    message:
      "[transpiler] void expression is approximated as (void)(...) in C++. Avoid it.",
  },
  {
    selector: "TSTypeOperator[operator='keyof']",
    message:
      "[transpiler] keyof has no C++ equivalent. Use an enum or string literal union.",
  },
  {
    selector: "TSAsExpression",
    message:
      "[transpiler] Type assertion (as) is type-only with no runtime effect in C++.",
  },
  {
    selector: "Literal[regex]",
    message:
      "[transpiler] RegExp literals are approximated with std::regex in C++, which has different syntax and performance.",
  },
  {
    selector: "TSEnumBody TSEnumMember Literal[raw=/[^0-9.]/]",
    message:
      "[transpiler] String-valued enum members have no C++ equivalent (C++ enums are integer-only). Use integer values or a Map.",
  },
  {
    selector:
      "TSTypeReference > Identifier[name=/^(Partial|Required|Readonly|Pick|Omit|Record|Exclude|Extract|NonNullable|ReturnType|InstanceType|Parameters|ConstructorParameters)$/]",
    message:
      "[transpiler] TypeScript utility types have no C++ equivalent and will be erased during transpilation. Define explicit interfaces or structs instead.",
  },
  {
    selector: "VariableDeclaration[kind='var']",
    message:
      "[transpiler] var declarations have no C++ equivalent. Use let or const instead.",
  },
  {
    selector: "FunctionDeclaration[generator=true]",
    message:
      "[transpiler] Generator functions (function*) are only partially supported. Yield/generator semantics differ in C++.",
  },
  {
    selector: "BinaryExpression[operator='in']",
    message:
      "[transpiler] The 'in' operator on non-map types is approximated in C++. Use a Map and its .has() method.",
  },
  {
    selector: "ArrowFunctionExpression[async=true]",
    message:
      "[transpiler] Async functions are approximated with a stub; semantics differ in C++.",
  },
  {
    selector: "FunctionDeclaration[async=true]",
    message:
      "[transpiler] Async functions are approximated with a stub; semantics differ in C++.",
  },
  {
    selector: "FunctionExpression[async=true]",
    message:
      "[transpiler] Async functions are approximated with a stub; semantics differ in C++.",
  },
];

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "**/*.js",
      "packages/**",
      "tests/**",
      "native_demo/**",
      "vscode-typehal-debug/**",
      "website/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "cuttlefish": transpilerPlugin,
    },
    rules: {
      "no-restricted-syntax": ["error", ...transpilerRules],
      "cuttlefish/no-delete-non-map": "error",
      "cuttlefish/no-object-static-non-map": "error",
      "cuttlefish/no-super-outside-method": "error",
      "cuttlefish/no-typeof-non-primitive": "error",
      "cuttlefish/no-destructured-without-init": "error",
      "cuttlefish/no-fractional-to-number-type": "error",
    },
  },
];
