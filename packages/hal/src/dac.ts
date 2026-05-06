import { emit } from './emit';
import { board } from './board';

/**
 * DACClass provides access to true digital-to-analog converters.
 * 
 * Note: This is for true analog output (DAC), distinct from PWM-based
 * analog simulation provided by Pin.pwm().
 */
export class DACClass {
  static readonly __instance_name = "DAC";

  write(pin: number, value: number): void {
    emit(`dacWrite(${pin}, ${value});`);
  }

  getResolution(): number {
    emit(`return ${board("peripherals.dac.0.resolution")};`);
    return 0;
  }
}

export const DAC = new DACClass();
