// ---------------------------------------------------------------------------
// @typecode/arch-avr-native — Native AVR architecture package
//
// This package provides native AVR register-level code generation for
// ATmega328P and similar AVR microcontrollers. It generates direct register
// access instead of Arduino framework function calls.
//
// Usage:
//   A board package imports this architecture and re-exports the strategy.
//   The board package provides pin mappings and board-specific constants.
// ---------------------------------------------------------------------------

// Register definitions and helpers (architecture-specific, board-agnostic)
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
} from './registers';

// Platform strategy for native AVR code generation
export { NativeAVRStrategy, PlatformStrategy } from './strategy';