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

// Profile resolution — FQBN → chip selection + diagnostics.
export { resolveAvrProfile, chipForBuildTarget } from './profile.js';
export type { ResolvedAvrProfile } from './profile.js';

// ---------------------------------------------------------------------------
// Toolchain — compile/upload/monitor via arduino-cli.
//
// framework-avr lowers to C++ that targets the same arduino:avr:<board> FQBN
// as framework-arduino, so the toolchain is identical: it shells out to
// arduino-cli. We re-export the arduino-compile implementation rather than
// duplicating it — the build/upload path has no framework-strategy coupling.
// ---------------------------------------------------------------------------
export {
  flattenGeneratedModulesIntoSketch,
  compileArduinoSketch,
  uploadArduinoSketch,
  monitorArduinoSketch,
} from '@typecad/framework-arduino';

import {
  flattenGeneratedModulesIntoSketch,
  compileArduinoSketch,
  uploadArduinoSketch,
  monitorArduinoSketch,
} from '@typecad/framework-arduino';

// Toolchain object for the framework registry (consumed by framework-package.ts).
export const Toolchain = {
  prepare: flattenGeneratedModulesIntoSketch,
  compile: (options: any) => compileArduinoSketch(options.sourcePath, options.buildTarget, {
    extraFlags: options.extraFlags,
    defines: options.defines,
  }),
  upload: (options: any) => uploadArduinoSketch(options.outputDir, options.buildTarget, options.port),
  monitor: (options: any) => monitorArduinoSketch(options.port, options.baud),
};

// ---------------------------------------------------------------------------
// Library resolution — re-exported from framework-arduino.
//
// Library discovery, header parsing, and .d.ts generation are all arduino-cli
// operations with no framework-strategy coupling, so AVR shares them verbatim.
// These satisfy the framework-package.ts loader contract's optional exports.
// ---------------------------------------------------------------------------
export { isFrameworkLibraryImport, getFrameworkLibraryHeaderName } from '@typecad/framework-arduino';
export { tryGenerateLibDecl } from '@typecad/framework-arduino';
export { buildClassNameMap } from '@typecad/framework-arduino';

// Platform strategy for native AVR code generation
// Export as FrameworkStrategy for consistency with other framework packages
export { NativeAVRStrategy, NativeAVRStrategy as FrameworkStrategy, PlatformStrategy } from './strategy.js';
