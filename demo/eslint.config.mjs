import tsparser from "@typescript-eslint/parser";
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
];

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts", "out/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
    },
    plugins: {
      cuttlefish: transpilerPlugin,
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
