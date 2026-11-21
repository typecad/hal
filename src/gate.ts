// ---------------------------------------------------------------------------
// Board-gate export classification
//
// In a cuttlefish project, user code imports hardware from '@typecad/hal' —
// which the project tsconfig maps onto the generated board module
// (.typecad-hal/board.ts). That module is the NARROWED gateway: hardware
// classes gated on board facts (PWM needs harvested silicon routes, the
// watchdog needs the DT watchdog node, ...) are re-exported only when this
// board's facts support them, so importing unavailable hardware fails at
// module resolution instead of at a deep diagnostic.
//
// This file records only the CLASSIFICATION: which of hal's value exports are
// board-gated. The ungated list is DERIVED (index.ts's runtime exports minus
// the gated set) by the board generators at generation time — via the
// engine's board-gate reader — so a new export in index.ts classifies itself
// as ungated without touching this file. Type-only exports are derived the
// same way (index.ts's `export type` specifiers, parsed statically by the
// same reader) — a new `export type` line re-exports itself from every
// generated board module with no list edits here.
//
// Drift is checked by tests/packages/cuttlefish/board-gate.test.ts.
// ---------------------------------------------------------------------------

/**
 * Hal VALUE exports gated on board facts — generated board modules re-export
 * these only when the board's facts support them (silicon routes, DT nodes,
 * wired buses). Everything else hal exports is ungated by construction.
 */
export const GATED_EXPORTS: readonly string[] = [
  'Watchdog',
  'PWM',
  'Servo',
  'ADC',
  'DAC',
  'I2CTarget',
  'I2CResponder',
  'SPITarget',
  'UART',
  'Counter',
  'Power',
  'Clock',
  'CAN',
  'I2S',
  'USBConsole',
  'Keyboard',
  'Mouse',
  'Store',
  'File',
  'BLE',
  'WiFi',
  'Scan',
  'WiFiAP',
];
