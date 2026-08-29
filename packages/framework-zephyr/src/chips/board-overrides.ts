// ---------------------------------------------------------------------------
// board-overrides.ts — curated board-level facts the devicetree cannot
// express. The honest residue of the board-package deletion: things a board
// vendor documents in a datasheet but never encodes in DTS.
//
// Keyed by the bare board id (the first segment of the qualified target, so
// every variant/qualifier of the board inherits the override).
// ----------------------------------------------------------------------------

export interface BoardOverride {
  /** LED pin name for boards whose user LED is not a gpio-leds node (the
   *  ESP32-S3 DevKitC's addressable RGB on GPIO48 — driven as plain GPIO,
   *  same as the deleted board package did). */
  readonly led?: string;
}

export const BOARD_OVERRIDES: Readonly<Record<string, BoardOverride>> = {
  esp32s3_devkitc: { led: 'GPIO48' },
};
