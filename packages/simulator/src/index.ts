// ---------------------------------------------------------------------------
// @typecad/simulator — Barrel export
// ---------------------------------------------------------------------------

// --- GPIO simulation ---
export { SimDigitalPin } from './gpio/digital-pin-sim.js';
export { SimAnalogPin } from './gpio/analog-pin-sim.js';
export { SimPWMPin } from './gpio/pwm-pin-sim.js';
export { SimInterruptPin } from './gpio/interrupt-sim.js';
export type { InterruptEvent } from './gpio/interrupt-sim.js';

// --- Bus simulation ---
export { SimSerialPort } from './bus/serial-sim.js';
export { SimI2CBus } from './bus/i2c-sim.js';
export type { I2COperationLog } from './bus/i2c-sim.js';
export { SimSPIBus } from './bus/spi-sim.js';
export type { SPIOperationLog } from './bus/spi-sim.js';

// --- Board factory ---
export { SimBoard, createSimBoard, attachSimulator } from './board/board-sim.js';

// --- Types ---
export { PinMode } from '@typecad/hal';
export type {
  PinChangeCallback,
  InterruptCallback,
  ISimI2CDevice,
  ISimSPIDevice,
  SimBoardType,
  SimBoardConfig,
} from './types.js';

// --- Helpers ---
export { createByteReadResult, createWriteResult } from './helpers.js';
