// ---------------------------------------------------------------------------
// @typecad/hal/sim — Interrupt simulation
// ---------------------------------------------------------------------------

import type { InterruptPin, InterruptOptions } from '../contracts.js';
import type { InterruptHandler } from '../../index.js';
import { SimDigitalPin } from './digital-pin-sim.js';

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
 * Extends SimDigitalPin with interrupt capabilities.
 * Tests can fire interrupts manually via `fireInterrupt()` and verify
 * that handlers were called with the correct arguments.
 */
export class SimInterruptPin extends SimDigitalPin implements InterruptPin {
  private _handlers: Map<InterruptMode, InterruptHandler> = new Map();
  private _debounceMs: number = 0;
  private _events: InterruptEvent[] = [];

  constructor(pinNum: number) {
    super(pinNum, { interrupt: true });
  }

  // --- InterruptPin capability methods ---

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

  offInterrupts(): void {
    this._handlers.clear();
  }

  /** Remove the rising-edge handler. */
  offRising(): void {
    this._handlers.delete('rising');
  }

  /** Remove the falling-edge handler. */
  offFalling(): void {
    this._handlers.delete('falling');
  }

  /** Remove all interrupt handlers. */
  offAll(): void {
    this._handlers.clear();
  }

  /** Check if any interrupt handlers are registered. */
  hasInterrupt(): boolean {
    return this._handlers.size > 0;
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
  override reset(): void {
    super.reset();
    this._handlers.clear();
    this._debounceMs = 0;
    this._events = [];
    this._startTime = Date.now();
  }
}
