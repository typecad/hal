// ---------------------------------------------------------------------------
// @typecad/test-pins — board test-pin role data
//
// Boards describe their testable pins declaratively in a `test-pins.json`
// shipped next to their package.json. Test suites import stable role names
// from the '@typecad/test-pins' virtual module:
//
//   import { GPIO_OUT, PWM_PIN } from '@typecad/test-pins';
//
// At hardware-test time the test-runner preprocessor substitutes each
// role identifier in the test source with the board's real pin symbol (and
// each fact with its numeric literal), rewriting the import to
// '@typecad/hal' — the exact lowering path hand-written per-board tests
// use. This module provides the schema, the JSON reader, and the
// editor-support generator (config-loader writes .typecad-hal/test-pins.ts
// so the language server resolves the specifier).
//
// Schema (all fields optional — a board only declares what it can test;
// suites gate themselves on role availability via `@typecad-requires-roles`):
//
//   {
//     "pins": {
//       "gpioOut": "PB5",            -> GPIO_OUT
//       "gpioIn": "PB0",             -> GPIO_IN
//       "pwm": "PB6",                -> PWM_PIN
//       "pwmAlt": "PB7",             -> PWM_ALT
//       "cs": "PA4",                 -> CS_PIN
//       "interrupt": "PA0",          -> INT_PIN
//       "led": "PC13",               -> LED_PIN
//       "button": "PA0"              -> BUTTON_PIN
//     },
//     "facts": {
//       "adcMax": 4095                -> ADC_MAX
//     },
//     "usb": {                        -> port discovery (host side only):
//       "vid": "2FE3",                multi-board test rigs match the
//       "pid": "0001",                console/upload port by USB identity
//       "serial": "…" (optional)      instead of tracking COM/tty numbers;
//     }                               Zephyr CDC boards all enumerate at
//   }                                 the default 2FE3:0001 — run one CDC
//                                       board at a time (see the expect
//                                       README's "USB port discovery")
//   }
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

/** Pin role -> exported const name. Single source for generator + env typing
 *  + the hardware test runner's substitutions. */
export const PIN_ROLES: Record<string, string> = {
  gpioOut: "GPIO_OUT",
  gpioIn: "GPIO_IN",
  pwm: "PWM_PIN",
  pwmAlt: "PWM_ALT",
  adcPin: "ADC_PIN",
  adcPinAlt: "ADC_PIN_ALT",
  cs: "CS_PIN",
  interrupt: "INT_PIN",
  led: "LED_PIN",
  button: "BUTTON_PIN",
  // Bus selector roles carry a quoted instance name ('I2C0'), not a pin
  // symbol — they export as string literals and substitute inline the same
  // way (the value text already includes the quotes).
  i2cBus: "I2C_BUS",
};

/** Fact role -> exported const name. */
export const FACT_ROLES: Record<string, string> = {
  adcMax: "ADC_MAX",
};

export interface TestPinsFile {
  pins?: Record<string, string | string[]>;
  facts?: Record<string, number>;
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Read and parse a project's test-pins.json. Returns undefined when absent. */
export function readTestPinsFile(projectDir: string): TestPinsFile | undefined {
  const jsonPath = path.join(projectDir, "test-pins.json");
  if (!fs.existsSync(jsonPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf8")) as TestPinsFile;
  } catch (e) {
    console.error(`[test-pins] Failed to parse ${jsonPath}: ${(e as Error).message}`);
    return undefined;
  }
}

/**
 * Build the generated module's source: role consts re-exported from the
 * board package. Used by the editor-support generator
 * (.typecad-hal/test-pins.ts — see config-loader's generateVirtualTypeDeclaration)
 * so the language server resolves the '@typecad/test-pins' specifier.
 * Hardware runs do NOT transpile this module: the test-runner
 * preprocessor substitutes role identifiers in test sources with the
 * board's real pin symbols before the transpiler runs (the HAL resolves
 * pins through board-package metadata, not through transpiled modules).
 * Returns undefined when the board declares no usable roles.
 */
export function buildTestPinsModuleContent(boardTarget: string, data: TestPinsFile): string | undefined {
  const lines: string[] = [
    `// Generated from ${boardTarget}/test-pins.json by the '@typecad/test-pins'`,
    `// resolver. Do not edit — regenerated on every transpile.`,
    `import {`,
  ];

  const importedPins: string[] = [];
  const exports: string[] = [];

  for (const [role, constName] of Object.entries(PIN_ROLES)) {
    const value = data.pins?.[role];
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      const names = value.filter((n): n is string => typeof n === "string" && IDENTIFIER_RE.test(n));
      if (names.length === 0) continue;
      importedPins.push(...names);
      exports.push(`export const ${constName} = [${names.join(", ")}];`);
    } else if (typeof value === "string" && IDENTIFIER_RE.test(value)) {
      importedPins.push(value);
      exports.push(`export const ${constName} = ${value};`);
    } else if (typeof value === "string" && /^'[^']*'$/.test(value)) {
      // Quoted selector text (a bus instance name) — export as-is; no board
      // pin import needed.
      exports.push(`export const ${constName} = ${value};`);
    } else {
      console.error(`[test-pins] Ignoring invalid pin role '${role}' in test-pins.json`);
    }
  }

  for (const [role, constName] of Object.entries(FACT_ROLES)) {
    const value = data.facts?.[role];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    exports.push(`export const ${constName} = ${value};`);
  }

  if (importedPins.length === 0 && exports.length === 0) return undefined;

  for (const name of [...new Set(importedPins)].sort()) {
    lines.push(`  ${name},`);
  }
    // Pin symbols live in the generated board module (the .typecad-hal sibling).
    lines.push(`} from './board.js';`);
  lines.push("");
  lines.push(...exports);
  lines.push("");

  return lines.join("\n");
}
