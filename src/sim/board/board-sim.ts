// ---------------------------------------------------------------------------
// @typecad/hal/sim — Simulated board factory
// ---------------------------------------------------------------------------

import type { SimBoardConfig } from '../types.js';
import { SimDigitalPin } from '../gpio/digital-pin-sim.js';
import { SimAnalogPin } from '../gpio/analog-pin-sim.js';
import { SimPWMPin } from '../gpio/pwm-pin-sim.js';
import { SimInterruptPin } from '../gpio/interrupt-sim.js';
import { SimSerialPort } from '../bus/serial-sim.js';
import { SimI2CBus } from '../bus/i2c-sim.js';
import { SimSPIBus } from '../bus/spi-sim.js';

// ---------------------------------------------------------------------------
// SimBoard
// ---------------------------------------------------------------------------

/**
 * A fully simulated board with GPIO pins and bus peripherals.
 *
 * Tests create a `SimBoard` via `createSimBoard()`, then access pins
 * and buses to inject data and verify behavior.
 */
export class SimBoard {
  readonly digitalPins: ReadonlyMap<number, SimDigitalPin>;
  readonly analogPins: ReadonlyMap<number, SimAnalogPin>;
  readonly pwmPins: ReadonlyMap<number, SimPWMPin>;
  readonly interruptPins: ReadonlyMap<number, SimInterruptPin>;
  readonly serialPorts: ReadonlyMap<number, SimSerialPort>;
  readonly i2cBuses: ReadonlyMap<number, SimI2CBus>;
  readonly spiBuses: ReadonlyMap<number, SimSPIBus>;

  constructor(config: SimBoardConfig) {
    const digitalCount = config.digitalPinCount ?? 14;
    const analogCount = config.analogPinCount ?? 6;
    const uartCount = config.uartCount ?? 1;
    const i2cCount = config.i2cBusCount ?? 1;
    const spiCount = config.spiBusCount ?? 1;

    // Digital pins
    const digitalMap = new Map<number, SimDigitalPin>();
    for (let i = 0; i < digitalCount; i++) {
      digitalMap.set(i, new SimDigitalPin(i));
    }
    this.digitalPins = digitalMap;

    // Analog pins (A0, A1, ...)
    const analogMap = new Map<number, SimAnalogPin>();
    for (let i = 0; i < analogCount; i++) {
      analogMap.set(i, new SimAnalogPin(i));
    }
    this.analogPins = analogMap;

    // PWM pins. Empty by default — declare capability pins via `pwmPins`, or
    // use `createBoardFromDefinition()` to derive them from a board package.
    const pwmMap = new Map<number, SimPWMPin>();
    const pwmPinNumbers = config.pwmPins ?? [];
    for (const pinNum of pwmPinNumbers) {
      if (pinNum < digitalCount) {
        pwmMap.set(pinNum, new SimPWMPin(pinNum));
      }
    }
    this.pwmPins = pwmMap;

    // Interrupt pins. Empty by default — declare them via `interruptPins`, or
    // use `createBoardFromDefinition()`.
    const interruptMap = new Map<number, SimInterruptPin>();
    const intPinNumbers = config.interruptPins ?? [];
    for (const pinNum of intPinNumbers) {
      if (pinNum < digitalCount) {
        interruptMap.set(pinNum, new SimInterruptPin(pinNum));
      }
    }
    this.interruptPins = interruptMap;

    // Serial ports
    const serialMap = new Map<number, SimSerialPort>();
    for (let i = 0; i < uartCount; i++) {
      serialMap.set(i, new SimSerialPort(config.uartRxBufferSize, config.uartTxBufferSize));
    }
    this.serialPorts = serialMap;

    // I2C buses
    const i2cMap = new Map<number, SimI2CBus>();
    for (let i = 0; i < i2cCount; i++) {
      i2cMap.set(i, new SimI2CBus(i));
    }
    this.i2cBuses = i2cMap;

    // SPI buses
    const spiMap = new Map<number, SimSPIBus>();
    for (let i = 0; i < spiCount; i++) {
      spiMap.set(i, new SimSPIBus());
    }
    this.spiBuses = spiMap;
  }

  // --- Convenience accessors ---

  /** Get digital pin by number. Throws if out of range. */
  digital(pin: number): SimDigitalPin {
    const p = this.digitalPins.get(pin);
    if (!p) throw new Error(`Digital pin ${pin} not available on this board`);
    return p;
  }

  /** Get analog pin by number (A0=0, A1=1, ...). Throws if out of range. */
  analog(pin: number): SimAnalogPin {
    const p = this.analogPins.get(pin);
    if (!p) throw new Error(`Analog pin A${pin} not available on this board`);
    return p;
  }

  /** Get PWM pin by number. Throws if not a PWM pin. */
  pwm(pin: number): SimPWMPin {
    const p = this.pwmPins.get(pin);
    if (!p) throw new Error(`Pin ${pin} is not a PWM pin on this board`);
    return p;
  }

  /** Get interrupt pin by number. Throws if not an interrupt pin. */
  interrupt(pin: number): SimInterruptPin {
    const p = this.interruptPins.get(pin);
    if (!p) throw new Error(`Pin ${pin} is not an interrupt pin on this board`);
    return p;
  }

  /** Get serial port by number (0 = UART0). */
  serial(port: number = 0): SimSerialPort {
    const s = this.serialPorts.get(port);
    if (!s) throw new Error(`Serial port UART${port} not available on this board`);
    return s;
  }

  /** Get I2C bus by number (0 = I2C0). */
  i2c(bus: number = 0): SimI2CBus {
    const b = this.i2cBuses.get(bus);
    if (!b) throw new Error(`I2C bus ${bus} not available on this board`);
    return b;
  }

  /** Get SPI bus by number (0 = SPI0). */
  spi(bus: number = 0): SimSPIBus {
    const b = this.spiBuses.get(bus);
    if (!b) throw new Error(`SPI bus ${bus} not available on this board`);
    return b;
  }

  // --- Reset ---

  /** Reset all peripherals to initial state. */
  reset(): void {
    for (const pin of this.digitalPins.values()) pin.reset();
    for (const pin of this.analogPins.values()) pin.reset();
    for (const pin of this.pwmPins.values()) pin.reset();
    for (const pin of this.interruptPins.values()) pin.reset();
    for (const port of this.serialPorts.values()) port.reset();
    for (const bus of this.i2cBuses.values()) bus.reset();
    for (const bus of this.spiBuses.values()) bus.reset();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a simulated board with the given configuration.
 *
 * @example
 * ```ts
 * const board = createSimBoard({ digitalPinCount: 14, pwmPins: [3, 5, 6, 9] });
 * board.digital(13).output();
 * board.digital(13).high();
 * expect(board.digital(13).getBitValue()).toBe(1);
 * ```
 */
export function createSimBoard(config: SimBoardConfig): SimBoard {
  return new SimBoard(config);
}
