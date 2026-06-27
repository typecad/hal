import { dacWrite, boardResolve } from './emit.js';

/**
 * DACClass provides access to true digital-to-analog converters.
 * 
 * Note: This is for true analog output (DAC), distinct from PWM-based
 * analog simulation provided by Pin.pwm().
 */
export class DACClass {
  static readonly __instance_name = "DAC";

  write(pin: number, value: number): void {
    dacWrite(pin, value);
  }

  getResolution(): number {
    return boardResolve("peripherals.dac.0.resolution");
  }
}

export const DAC = new DACClass();
