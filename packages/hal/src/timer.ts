import { boardResolve } from './emit.js';
import { callback } from './callback.js';

/**
 * HardwareTimer provides direct control over the board's hardware timers.
 *
 * Hardware timers are distinct from the software-based setInterval/setTimeout
 * and are typically used for high-precision timing, PWM generation, or
 * interrupt-driven tasks. Lowered to hwtimer.* HAL ops: ESP-IDF's GPTimer
 * driver (driver/gptimer.h); Arduino's HardwareTimer (Timer0/1/2 on STM32).
 *
 * The instance index maps to the platform's timer numbering (ESP-IDF GPTimer
 * unit 0..n, STM32 TIM0..n).
 */
export class HardwareTimer {
  private _instance: number;

  constructor(instance: number) {
    this._instance = instance;
  }

  /** Sets the timer frequency in Hertz. */
  setFrequency(hz: number): void {
    hwtimerSetFrequency(this._instance, hz);
  }

  /** Attaches an interrupt handler that executes when the timer overflows. */
  onOverflow(handler: () => void): void {
    hwtimerOnOverflow(this._instance, callback(handler));
  }

  /** Starts the timer. */
  start(): void {
    hwtimerStart(this._instance);
  }

  /** Stops the timer. */
  stop(): void {
    hwtimerStop(this._instance);
  }

  /** Returns the bit resolution of the timer (e.g., 8, 16, 32). */
  getBits(): number {
    // "peripherals.timer" (singular) matches the board-resolver's array-key
    // derivation (TIMER_INSTANCES → peripherals.timer.<index>.*).
    return boardResolve("peripherals.timer." + this._instance + ".bits");
  }
}

export const Timer0 = new HardwareTimer(0);
export const Timer1 = new HardwareTimer(1);
export const Timer2 = new HardwareTimer(2);

// ── Semantic primitives (resolved to hwtimer.* HAL ops by the transpiler) ──
export function hwtimerSetFrequency(instance: number, hz: number): void {}
export function hwtimerOnOverflow(instance: number, handler: string): void {}
export function hwtimerStart(instance: number): void {}
export function hwtimerStop(instance: number): void {}
