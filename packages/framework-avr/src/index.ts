// ---------------------------------------------------------------------------
// @typecad/framework-avr — Native AVR framework package
//
// This package provides native AVR register-level code generation for
// ATmega328P and similar AVR microcontrollers. It generates direct register
// access instead of Arduino framework function calls.
//
// Usage:
//   In typecad.config.ts:
//     framework: '@typecad/framework-avr'
// ---------------------------------------------------------------------------

// Register definitions and helpers (AVR-specific)
export {
  PinRegisterInfo,
  PWMInfo,
  getPinInfo,
  parsePinFromReceiver,
  getPinBitMask,
  getPortReg,
  getDDRReg,
  getADCChannel,
  getPWMInfo,
  isPWMPin,
  getPWMPins,
  inferReceiverKind,
  getInterruptInfo,
  isInterruptPin,
} from './registers.js';

// Chip descriptors — author one per supported AVR MCU.
export type {
  AVRChipDescriptor,
  AVRPinMap,
  AVRTimer,
  AVRPwmPin,
  AVRInterruptPin,
  AVRAdcConfig,
  AVRUartConfig,
} from './chips/types.js';
export { ATMEGA328P, ATMEGA2560, setActiveChip } from './chips/index.js';

// Platform strategy for native AVR code generation
// Export as FrameworkStrategy for consistency with other framework packages
export { NativeAVRStrategy, NativeAVRStrategy as FrameworkStrategy, PlatformStrategy } from './strategy.js';
