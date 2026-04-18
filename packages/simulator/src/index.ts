// ---------------------------------------------------------------------------
// @typecode/simulator — Barrel export
// ---------------------------------------------------------------------------

// --- GPIO simulation ---
export { SimDigitalPin } from './gpio/digital-pin-sim';
export { SimAnalogPin } from './gpio/analog-pin-sim';
export { SimPWMPin } from './gpio/pwm-pin-sim';
export { SimInterruptPin } from './gpio/interrupt-sim';
export type { InterruptEvent } from './gpio/interrupt-sim';

// --- Bus simulation ---
export { SimSerialPort } from './bus/serial-sim';
export { SimI2CBus } from './bus/i2c-sim';
export type { I2COperationLog } from './bus/i2c-sim';
export { SimSPIBus } from './bus/spi-sim';
export type { SPIOperationLog } from './bus/spi-sim';

// --- Board factory ---
export { SimBoard, createSimBoard } from './board/board-sim';

// --- Types ---
export { PinMode } from '@typecode/core';
export type {
  PinChangeCallback,
  InterruptCallback,
  ISimI2CDevice,
  ISimSPIDevice,
  SimBoardType,
  SimBoardConfig,
} from './types';

// --- Helpers ---
export { createByteReadResult, createWriteResult } from './helpers';
