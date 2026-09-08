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
// as ungated without touching this file. Type-only exports cannot be
// introspected at runtime, so the ungated type list stays here by hand.
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
  'ADC',
  'DAC',
  'I2CTarget',
  'SPITarget',
  'UART',
  'Counter',
  'USBConsole',
  'Store',
  'File',
];

/**
 * Hal TYPE-ONLY exports re-exported unconditionally by generated board
 * modules (`export type { ... }`). Mirrors the `export type` lines of
 * index.ts; not runtime-introspectable, so kept in sync by hand.
 */
export const BOARD_UNGATED_TYPE_EXPORTS: readonly string[] = [
  'DigitalValue',
  'AnalogValue',
  'InterruptHandler',
  'ArchitectureIdentifier',
  'SerialValue',
  'SensorToken',
  'SensorChannelName',
  'SensorPartInfo',
  'Bit',
  'Bits',
  'RequestOpts',
  'GattCharacteristicDef',
  'CharValue',
];
