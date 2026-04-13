// ---------------------------------------------------------------------------
// @typecode/simulator — Interrupt simulation
// ---------------------------------------------------------------------------

import type {
  IInterruptPin,
  InterruptHandler,
} from '@typecode/core';
import type { InterruptOptions } from '@typecode/core';

type InterruptMode = 'rising' | 'falling' | 'change';

/**
 * Tracks interrupt firings for test assertions.
 */
export interface InterruptEvent {
  /** Timestamp (ms since simulation start) */
  timestamp: number;
  /** The trigger mode */
  mode: InterruptMode;
  /** The pin value at time of interrupt */
  pinValue: number;
}

/**
 * Simulated interrupt controller for a single pin.
 *
 * Tests can fire interrupts manually via `fireInterrupt()` and verify
 * that handlers were called with the correct arguments.
 */
export class SimInterruptPin implements IInterruptPin {
  readonly number: number;
  readonly gpio: number;

  private _handlers: Map<InterruptMode, InterruptHandler> = new Map();
  private _debounceMs: number = 0;
  private _events: InterruptEvent[] = [];
  private _startTime: number = Date.now();

  constructor(pinNum: number) {
    this.number = pinNum;
    this.gpio = pinNum;
  }

  // --- IPin (minimal) ---

  getMode(): any { return 'INPUT'; }
  setMode(_mode: any): void {}

  // --- IInterruptPin ---

  hasInterrupt(): boolean {
    return this._handlers.size > 0;
  }

  onRising(handler: InterruptHandler, options?: InterruptOptions): void {
    this._handlers.set('rising', handler);
    if (options?.debounce) this._debounceMs = options.debounce;
  }

  onFalling(handler: InterruptHandler, options?: InterruptOptions): void {
    this._handlers.set('falling', handler);
    if (options?.debounce) this._debounceMs = options.debounce;
  }

  onChange(handler: InterruptHandler, options?: InterruptOptions): void {
    this._handlers.set('change', handler);
    if (options?.debounce) this._debounceMs = options.debounce;
  }

  offRising(): void {
    this._handlers.delete('rising');
  }

  offFalling(): void {
    this._handlers.delete('falling');
  }

  offChange(): void {
    this._handlers.delete('change');
  }

  offAll(): void {
    this._handlers.clear();
  }

  // --- Simulation helpers ---

  /**
   * Fire an interrupt manually from test code.
   * @param mode - The interrupt mode to fire
   * @param pinValue - The current pin value (for event logging)
   */
  fireInterrupt(mode: InterruptMode, pinValue: number = 0): void {
    const handler = this._handlers.get(mode);
    if (handler) {
      handler();
    }

    // Also fire 'change' handler for any edge
    if (mode !== 'change' && this._handlers.has('change')) {
      this._handlers.get('change')!();
    }

    this._events.push({
      timestamp: Date.now() - this._startTime,
      mode,
      pinValue,
    });
  }

  /**
   * Simulate a pin value transition, automatically firing the appropriate interrupts.
   * @param from - Previous pin value (0 or 1)
   * @param to - New pin value (0 or 1)
   */
  simulateTransition(from: number, to: number): void {
    if (from === to) return;

    if (from === 0 && to === 1) {
      this.fireInterrupt('rising', to);
    } else if (from === 1 && to === 0) {
      this.fireInterrupt('falling', to);
    }
  }

  /**
   * Get all recorded interrupt events.
   */
  getEvents(): readonly InterruptEvent[] {
    return this._events;
  }

  /**
   * Clear interrupt event history.
   */
  clearEvents(): void {
    this._events = [];
  }

  /**
   * Get the configured debounce time.
   */
  getDebounceMs(): number {
    return this._debounceMs;
  }

  /**
   * Reset to initial state.
   */
  reset(): void {
    this._handlers.clear();
    this._debounceMs = 0;
    this._events = [];
    this._startTime = Date.now();
  }
}
