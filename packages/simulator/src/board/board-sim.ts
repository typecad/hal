// ---------------------------------------------------------------------------
// @typecad/simulator — Simulated board factory
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

    // PWM pins (commonly 3, 5, 6, 9, 10, 11 on Uno)
    const pwmMap = new Map<number, SimPWMPin>();
    const pwmPinNumbers = getPwmPinsForBoard(config.boardType);
    for (const pinNum of pwmPinNumbers) {
      if (pinNum < digitalCount) {
        pwmMap.set(pinNum, new SimPWMPin(pinNum));
      }
    }
    this.pwmPins = pwmMap;

    // Interrupt pins (commonly 2, 3 on Uno)
    const interruptMap = new Map<number, SimInterruptPin>();
    const intPinNumbers = getInterruptPinsForBoard(config.boardType);
    for (const pinNum of intPinNumbers) {
      if (pinNum < digitalCount) {
        interruptMap.set(pinNum, new SimInterruptPin(pinNum));
      }
    }
    this.interruptPins = interruptMap;

    // Serial ports
    const serialMap = new Map<number, SimSerialPort>();
    for (let i = 0; i < uartCount; i++) {
      serialMap.set(i, new SimSerialPort(i, config.uartRxBufferSize, config.uartTxBufferSize));
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
 * const board = createSimBoard({ boardType: 'arduino-uno' });
 * board.digital(13).output();
 * board.digital(13).high();
 * expect(board.digital(13).getBitValue()).toBe(1);
 * ```
 */
export function createSimBoard(config: SimBoardConfig): SimBoard {
  return new SimBoard(config);
}

// ---------------------------------------------------------------------------
// Board-specific pin maps
// ---------------------------------------------------------------------------

function getPwmPinsForBoard(boardType: string): number[] {
  switch (boardType) {
    case 'arduino-uno':
    case 'arduino-nano':
      return [3, 5, 6, 9, 10, 11];
    default:
      return [3, 5, 6, 9, 10, 11];
  }
}

function getInterruptPinsForBoard(boardType: string): number[] {
  switch (boardType) {
    case 'arduino-uno':
    case 'arduino-nano':
      return [2, 3];
    default:
      return [2, 3];
  }
}

// ---------------------------------------------------------------------------
// Board Monkey-Patching
// ---------------------------------------------------------------------------

/**
 * Patch a single pin stub with the implementation from a simulator pin.
 */
function patchPin(stub: any, sim: any): void {
  if (!stub || !sim) return;
  // Copy prototype methods (e.g. read, write, high, low)
  Object.setPrototypeOf(stub, Object.getPrototypeOf(sim));
  
  // Copy state properties (e.g. _value, _history), but PRESERVE stub's identity
  for (const key of Object.keys(sim)) {
    if (key !== 'number' && key !== 'gpio' && key !== 'capabilities') {
      stub[key] = sim[key];
    }
  }
}

/**
 * Attaches a simulator to an existing board singleton, monkey-patching all
 * its pins and buses with fully simulated implementations. This allows
 * firmware to import the board singleton normally and use it in tests.
 */
export function attachSimulator(board: any): SimBoard {
  if (!board || !board.definition || !board.definition.id) {
    throw new Error('attachSimulator expects a valid Board singleton');
  }

  const simBoard = createSimBoard({ boardType: board.definition.id });

  // Patch digital pins
  if (board.digital) {
    for (const key of Object.keys(board.digital)) {
      const pinStub = board.digital[key];
      if (pinStub && typeof pinStub.number === 'number') {
        const pinNum = pinStub.number;
        
        let bestSimPin = simBoard.digitalPins.get(pinNum);
        if (simBoard.pwmPins.has(pinNum)) {
          bestSimPin = simBoard.pwmPins.get(pinNum);
        } else if (simBoard.interruptPins.has(pinNum)) {
          bestSimPin = simBoard.interruptPins.get(pinNum);
        }
        
        if (bestSimPin) {
           patchPin(pinStub, bestSimPin);
           
           (simBoard.digitalPins as Map<number, any>).set(pinNum, pinStub);
           if (simBoard.pwmPins.has(pinNum)) (simBoard.pwmPins as Map<number, any>).set(pinNum, pinStub);
           if (simBoard.interruptPins.has(pinNum)) (simBoard.interruptPins as Map<number, any>).set(pinNum, pinStub);
        }
      }
    }
  }

  // Patch analog pins
  if (board.analog) {
    for (const key of Object.keys(board.analog)) {
      const pinStub = board.analog[key];
      if (pinStub && typeof pinStub.gpio === 'number') {
        if (key.startsWith('A')) {
          const aIndex = parseInt(key.substring(1), 10);
          const simPin = simBoard.analogPins.get(aIndex);
          if (simPin) {
             patchPin(pinStub, simPin);
             (simBoard.analogPins as Map<number, any>).set(aIndex, pinStub);
             
             if (typeof pinStub.number === 'number') {
               (simBoard.digitalPins as Map<number, any>).set(pinStub.number, pinStub);
             }
          }
        }
      }
    }
  }

  // Patch I2C buses (I2C0)
  if (board.I2C0) {
    const simI2c = simBoard.i2cBuses.get(0);
    patchPin(board.I2C0, simI2c);
    (simBoard.i2cBuses as Map<number, any>).set(0, board.I2C0);
  }

  // Patch SPI buses (SPI0)
  if (board.SPI0) {
    const simSpi = simBoard.spiBuses.get(0);
    patchPin(board.SPI0, simSpi);
    (simBoard.spiBuses as Map<number, any>).set(0, board.SPI0);
  }

  // Patch UART buses (UART0)
  if (board.UART0) {
    const simUart = simBoard.serialPorts.get(0);
    patchPin(board.UART0, simUart);
    (simBoard.serialPorts as Map<number, any>).set(0, board.UART0);
  }

  return simBoard;
}
