// ---------------------------------------------------------------------------
// cuttlefish test-runner — Board test-pins resolution
//
// Boards ship a declarative test-pins.json next to their package.json (see
// src/transpile/test-pins.ts for the schema). Suites import stable role
// names from '@typecad/test-pins' and declare what they need with a
// `// @typecad-requires-roles pwm, cs` comment:
//
//   - The runner skips files whose board cannot provide the required roles.
//   - The preprocessor substitutes every role identifier in the test source
//     with the board's real pin symbol (facts become numeric literals) and
//     rewrites the import to '@typecad/hal' — the exact lowering path
//     hand-written per-board tests use, so the transpiler's HAL metadata
//     resolution sees the same source it always has.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
// Single source of truth for the role vocabulary — shared with the env-d.ts
// generator and the test-pins module writer in the transpiler.
import { PIN_ROLES, FACT_ROLES } from '../transpile/test-pins.js';

/** Pin role -> role const name used in test sources. */
export const PIN_ROLE_CONSTS: Record<string, string> = PIN_ROLES;

/** Fact role -> fact const name used in test sources. */
export const FACT_ROLE_CONSTS: Record<string, string> = FACT_ROLES;

export interface TestPinsData {
  pins?: Record<string, string | string[]>;
  facts?: Record<string, number>;
  /**
   * USB identity for port discovery — how a multi-board rig finds this
   * board's console/upload port without tracking COM/tty numbers. Zephyr
   * CDC boards carry their per-board PID here (matching zephyr.usb.vid/pid
   * in the board package); UART-bridge boards carry the bridge chip's ID
   * (Uno 16U2 2341:0043, ESP32 DevKitC CP2102 10C4:EA60).
   */
  usb?: { vid: string; pid: string; serial?: string };
}

/**
 * Substitution map handed to the preprocessor: role const name -> the
 * TypeScript text that replaces it (a pin symbol, an array literal of pin
 * symbols, or a numeric literal).
 */
export type TestPinsSubstitutions = Map<string, string>;

export function buildTestPinsSubstitutions(data: TestPinsData): TestPinsSubstitutions {
  const substitutions = new Map<string, string>();

  for (const [role, constName] of Object.entries(PIN_ROLE_CONSTS)) {
    const value = data.pins?.[role];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) substitutions.set(constName, `[${value.join(', ')}]`);
    } else if (typeof value === 'string') {
      substitutions.set(constName, value);
    }
  }

  for (const [role, constName] of Object.entries(FACT_ROLE_CONSTS)) {
    const value = data.facts?.[role];
    if (typeof value === 'number' && Number.isFinite(value)) {
      substitutions.set(constName, String(value));
    }
  }

  return substitutions;
}

/** Roles (pin + fact keys) the data provides, for requires-roles gating. */
export function testPinsRolesOf(data: TestPinsData): Set<string> {
  const roles = new Set<string>();
  for (const key of Object.keys(data.pins ?? {})) roles.add(key);
  for (const key of Object.keys(data.facts ?? {})) roles.add(key);
  return roles;
}

/** Locate a workspace/npm package directory by walking node_modules upward. */
function findPackageDir(fromDir: string, packageName: string): string | undefined {
  let searchDir = path.resolve(fromDir);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(searchDir, 'node_modules', ...packageName.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(searchDir);
    if (parent === searchDir) break;
    searchDir = parent;
  }
  return undefined;
}

/**
 * Load the project's test-pins.json. A file co-located with the chosen
 * typecad-hal.config.ts wins (boards/<name>/test-pins.json — one pins set per
 * board config in a multi-board project); the project root is the fallback
 * (and the location for single-board projects). Returns undefined when
 * neither exists.
 */
export function boardTestPins(
  _board: string,
  projectRoot: string,
  configPath?: string,
): TestPinsData | undefined {
  void _board;
  const candidates = configPath
    ? [path.join(path.dirname(configPath), 'test-pins.json'), path.join(projectRoot, 'test-pins.json')]
    : [path.join(projectRoot, 'test-pins.json')];
  for (const jsonPath of candidates) {
    if (!fs.existsSync(jsonPath)) continue;
    try {
      return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as TestPinsData;
    } catch {
      // Malformed JSON — try the next candidate.
    }
  }
  return undefined;
}
