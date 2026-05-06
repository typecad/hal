import { emit } from './emit';
import { board } from './board';
import { callback } from './callback';

/**
 * HardwareTimer provides direct control over the board's hardware timers.
 * 
 * Hardware timers are distinct from the software-based setInterval/setTimeout
 * and are typically used for high-precision timing, PWM generation, or
 * interrupt-driven tasks.
 */
export class HardwareTimer {
  private _instance: number;

  constructor(instance: number) {
    this._instance = instance;
  }

  /**
   * Sets the timer frequency in Hertz.
   * Note: The actual frequency may be limited by the hardware's clock dividers.
   */
  setFrequency(hz: number): void {
    emit(`// Hardware timer frequency control is target-specific`);
    emit(`Timer${this._instance}.setFrequency(${hz});`);
  }

  /**
   * Attaches an interrupt handler that executes when the timer overflows.
   */
  onOverflow(handler: () => void): void {
    emit(`Timer${this._instance}.onOverflow(${callback(handler)});`);
  }

  /**
   * Starts the timer.
   */
  start(): void {
    emit(`Timer${this._instance}.start();`);
  }

  /**
   * Stops the timer.
   */
  stop(): void {
    emit(`Timer${this._instance}.stop();`);
  }

  /**
   * Returns the bit resolution of the timer (e.g., 8, 16, 32).
   */
  getBits(): number {
    return board(`peripherals.timers.${this._instance}.bits`);
  }
}

export const Timer0 = new HardwareTimer(0);
export const Timer1 = new HardwareTimer(1);
export const Timer2 = new HardwareTimer(2);
