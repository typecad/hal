// ---------------------------------------------------------------------------
// Drift guard: feature-registry.ts LINT_RULES ↔ generateEslintConfig() output
//
// Ensures the `no-restricted-syntax` selectors rendered into the scaffolded
// eslint.config.mjs stay in sync with the single source of truth
// (feature-registry.ts). Without this test, adding a registry entry with no
// matching selector — or editing the template by hand — would silently cause
// editor warnings and build-time diagnostics to diverge.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import ts from "typescript";
import {
  generateEslintConfig,
  LINT_RULES,
  ESLINT_OPT_OUT_KINDS,
  kindRegistryEntries,
} from "@typecad/cuttlefish/testing";
import type { CreateProjectOptions } from "@typecad/cuttlefish/testing";

const OPTIONS: CreateProjectOptions = {
  projectName: "parity-fixture",
  targetId: "arduino:avr:uno",
  targetDisplayName: "Arduino Uno",
  isNative: false,
  frameworkPackage: "@typecad/framework-arduino",
  framework: "arduino",
  includeSketch: true,
};

describe("LINT_RULES ↔ generateEslintConfig parity", () => {
  const config = generateEslintConfig(OPTIONS);

  it("renders every LINT_RULES selector into the config", () => {
    expect(LINT_RULES.length).toBeGreaterThan(0);
    for (const rule of LINT_RULES) {
      // The selector is emitted as a JSON string value, so wrap it in quotes.
      expect(
        config,
        `selector "${rule.selector}" (source: ${rule.source}) is missing from generateEslintConfig output`,
      ).toContain(`"selector": "${rule.selector}"`);
    }
  });

  it("renders every LINT_RULES message into the config", () => {
    for (const rule of LINT_RULES) {
      expect(
        config,
        `message for selector "${rule.selector}" is missing from generateEslintConfig output`,
      ).toContain(rule.message);
    }
  });

  it("exempts ui.bind from the .bind restriction (and only ui.bind)", () => {
    // ui.bind is the UI framework's compile-time signal-binding API, not
    // Function.prototype.bind. The exemption must live in the selector itself
    // (generateEslintConfig drops the `filter` field), so the generated config
    // must carry :not([object.name='ui']) — otherwise every ui.bind(...) call
    // is a false-positive error. Regression guard for the alpha.11 false-positive.
    const bindRule = LINT_RULES.find((r) =>
      r.selector.includes("property.name='bind']"),
    );
    expect(bindRule, "bind rule should exist in LINT_RULES").toBeTruthy();
    expect(bindRule!.selector).toContain(":not([object.name='ui'])");
    // ui.call/ui.apply are NOT UI APIs — the build prescan flags them, so the
    // editor selector must not exempt the `ui` receiver for them either.
    const callApplyRule = LINT_RULES.find((r) =>
      r.selector.includes("property.name=/^(call|apply)$/]"),
    );
    expect(callApplyRule, ".call/.apply rule should exist in LINT_RULES").toBeTruthy();
    expect(callApplyRule!.selector).not.toContain(":not(");
    expect(config).toContain(":not([object.name='ui'])");
  });

  it("does not contain the old hand-maintained header comment", () => {
    // Guards against a revert that re-introduces the dual-maintained literal.
    expect(config).not.toContain("no-restricted-syntax selectors sourced from SUPPORT_MATRIX");
  });

  it("tags the generated block as auto-generated", () => {
    expect(config).toContain("Auto-generated from feature-registry.ts LINT_RULES");
  });
});

describe("feature-registry kind coverage", () => {
  // Every KIND_REGISTRY entry must either contribute an ESLint selector (via
  // `.eslint`) or be explicitly listed in ESLINT_OPT_OUT_KINDS. This catches
  // the failure mode where someone adds `add(SomeKind, {...})` for a build-time
  // diagnostic but forgets the editor-time selector, silently re-introducing
  // the drift this refactor eliminated.
  it("every kind registry entry has .eslint or is explicitly opted out", () => {
    const kindNames = (k: ts.SyntaxKind): string => ts.SyntaxKind[k];
    for (const [kind, entry] of kindRegistryEntries()) {
      if (entry.eslint) {
        continue;
      }
      expect(
        ESLINT_OPT_OUT_KINDS.has(kind),
        `kind ${kindNames(kind)} has no .eslint selector and is not in ESLINT_OPT_OUT_KINDS — ` +
          `either add an eslint selector or document the opt-out in feature-registry.ts`,
      ).toBe(true);
    }
  });

  it("the backfilled kinds (regex / BigIntLiteral / TemplateLiteralType) now have selectors", () => {
    // Regression guard for the specific drift the refactor originally fixed.
    const find = (k: ts.SyntaxKind): boolean =>
      LINT_RULES.some((r) =>
        r.selector.includes(
          {
            [ts.SyntaxKind.RegularExpressionLiteral as number]: "[regex]",
            [ts.SyntaxKind.BigIntLiteral as number]: "[bigint]",
            [ts.SyntaxKind.TemplateLiteralType as number]: "TSTemplateLiteralType",
          }[k as number] ?? "<<<unknown>>>",
        ),
      );

    expect(find(ts.SyntaxKind.RegularExpressionLiteral)).toBe(true);
    expect(find(ts.SyntaxKind.BigIntLiteral)).toBe(true);
    expect(find(ts.SyntaxKind.TemplateLiteralType)).toBe(true);
  });
});
