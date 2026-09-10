// ---------------------------------------------------------------------------
// @typecad/hal/sim — Barrel export
// ---------------------------------------------------------------------------

// --- GPIO simulation ---
export { SimDigitalPin } from './gpio/digital-pin-sim.js';
export { SimAnalogPin } from './gpio/analog-pin-sim.js';
export { SimPWMPin } from './gpio/pwm-pin-sim.js';
export { SimInterruptPin } from './gpio/interrupt-sim.js';

// --- Bus simulation ---
export { SimSerialPort } from './bus/serial-sim.js';
export { SimI2CBus } from './bus/i2c-sim.js';
export type { I2COperationLog } from './bus/i2c-sim.js';
export { SimSPIBus } from './bus/spi-sim.js';
export type { SPIOperationLog } from './bus/spi-sim.js';

// --- Board factory ---
export { SimBoard, createSimBoard } from './board/board-sim.js';
export { createBoardFromManifest, manifestPinNumberByName } from './board/from-manifest.js';
export type { BoardManifest } from './board/from-manifest.js';

// --- Runtime contract interfaces (relocated from @typecad/hal) ---
// Pin/bus contracts implemented by the Sim* classes above.
export type {
  BasePin,
  PWMPin,
  AnalogPin,
  InterruptPin,
  II2CBus,
  II2CDeviceAccessor,
  ISPIBus,
  ISPIDevice,
  IUARTBus,
  ISerialPort,
  PinCapabilityFlags,
  InterruptOptions,
  ErrorPolicy,
} from './contracts.js';

export { I2CStatus, SPIStatus } from './contracts.js';
export { hasPWM, hasAnalogInput, hasInterrupt, assertPWM, assertAnalog, assertInterrupt } from './contracts.js';

// --- Types ---
export { PinMode } from '../index.js';
export type {
  ISimI2CDevice,
  ISimSPIDevice,
  SimBoardConfig,
} from './types.js';

// --- Helpers ---
export { createByteReadResult, createWriteResult } from './helpers.js';
