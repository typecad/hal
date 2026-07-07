// ---------------------------------------------------------------------------
// board-checklist.ts — Generates the "manual framework steps remaining"
// checklist printed after `cuttlefish board add`. The tool does not apply
// these edits (they require per-chip judgement), but it tells the user exactly
// what to do.
// ---------------------------------------------------------------------------

import type { BoardSpec } from './board-spec.js';

export function generateFrameworkChecklist(spec: BoardSpec): string {
  const arch = spec.architecture;
  const a0 = getA0Fallback(spec);
  const fqbnPrefix = spec.fqbn.split(':').slice(0, 2).join(':') + ':';

  const lines: string[] = [
    '',
    '━━━ Manual framework steps remaining ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    'The tool cannot safely apply these (they vary per chip). Check whether',
    `'${arch}' is already present in each file; if not, add it:`,
    '',
    `1. packages/cuttlefish/src/api/board-types.ts`,
    `   Add \`| '${arch}'\` to the ArchitectureIdentifier union.`,
    '',
    `2. packages/hal/src/core/board-types.ts`,
    `   Same addition (the union is duplicated in both packages).`,
    '',
    `3. packages/framework-arduino/src/strategy.ts — freeHeap() (~line 234)`,
    `   Add \`|| arch === '${arch}'\` to the ESP32-family check.`,
    '',
    `4. packages/framework-arduino/src/strategy.ts — isrFunctionAttribute() (~line 1004)`,
    `   Add \`|| arch === '${arch}'\` to the same check.`,
    '',
    `5. packages/cuttlefish/src/ir/heap-analysis.ts (~line 74)`,
    `   Add \`|| arch === '${arch}'\` to the architecture gate.`,
    '',
    `6. packages/framework-arduino/src/profile.ts — PROFILE_VARIANTS`,
    `   Add \`{ architecture: "${arch}", forcedIncludes: ["<Arduino.h>"] }\`.`,
    `   Also add a CAPABILITY_TABLE row (mirror esp32; fallbackPins.A0 = ${a0}).`,
    `   Also add an FQBN_PIN_OVERRIDES entry: \`{ fqbnIncludes: "${fqbnPrefix}", pins: { A0: ${a0} } }\`.`,
    '',
    'Then rebuild and test:',
    '  npm run build --workspaces',
    '  npx vitest run tests/packages/transpiler/init-scaffold.test.ts',
    '  npx vitest run tests/packages/framework-arduino/',
    '',
  ];
  return lines.join('\n');
}

function getA0Fallback(spec: BoardSpec): number {
  // A0 maps to the first ADC1 pin. The analog array lists ADC1 pins in order;
  // A0 = the GPIO number of the first entry. Parse "GPIOn" → n.
  const firstAnalog = spec.analog[0];
  const match = firstAnalog.match(/GPIO(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}
