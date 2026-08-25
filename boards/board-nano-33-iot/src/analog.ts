// ---------------------------------------------------------------------------
// @typecad/board-nano-33-iot — Analog constants
// ---------------------------------------------------------------------------

/** Default reference: VDDANA/2 = 1.65 V (the Zephyr sam0 driver's
 *  ADC_REF_VDD_1_2 / INTVCC0 — the only full-ish-range internal reference
 *  the driver exposes on SAM D21 at gain 1x). Reads saturate above ~1.65 V. */
export const DEFAULT = 0;
