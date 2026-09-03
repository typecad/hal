// ---------------------------------------------------------------------------
// test-pins-env.d.ts — Ambient declaration for the '@typecad/test-pins'
// virtual module (editor/type-check support only).
//
// At transpile time the module is generated from the configured board
// package's test-pins.json (packages/cuttlefish/src/transpile/test-pins.ts)
// and re-exports only the roles that board declares. This declaration types
// the full role vocabulary so test files type-check in the editor regardless
// of which board's JSON is active.
// ---------------------------------------------------------------------------

declare module '@typecad/test-pins' {
  import type { Pin } from '@typecad/hal';

  export const GPIO_OUT: Pin;
  export const GPIO_IN: Pin;
  export const PWM_PIN: Pin;
  export const PWM_ALT: Pin;
  export const ADC_PIN: Pin;
  export const ADC_PIN_ALT: Pin;
  export const CS_PIN: Pin;
  export const INT_PIN: Pin;
  export const LED_PIN: Pin;
  export const BUTTON_PIN: Pin;
  /** Bus instance selector text (e.g. I2C0), not a Pin. */
  export const I2C_BUS: string;

  export const ADC_MAX: number;
}
