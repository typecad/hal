// ---------------------------------------------------------------------------
// @typecad/board-blackpill-f411ce — Analog constants
// ---------------------------------------------------------------------------

/** Default reference: VDDA = 3.3 V (the st,stm32-adc binding's vref-mv). */
export const DEFAULT = 0;
// The internal VREFINT channel (~1.21 V) exists on silicon but is not exposed
// as a HAL reference — the Zephyr channel setup always uses ADC_REF_INTERNAL
// (VREF+ pad = VDDA) with ADC_GAIN_1, per the STM32 driver's requirements.
