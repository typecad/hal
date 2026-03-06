// ---------------------------------------------------------------------------
// @typecode/board-native-uno — Arduino Uno with native AVR codegen
//
// This package provides the same board definition and exports as
// @typecode/board-arduino-uno, but uses the NativeAVRStrategy for
// direct register access instead of Arduino framework calls.
//
// Usage in typecode.config.ts:
//   board: '@typecode/board-native-uno'
// ---------------------------------------------------------------------------

// Export the native strategy for code generation
export { BoardStrategy } from './strategy';

// Re-export everything from the Arduino Uno board package
// (pins, peripherals, timing, board definition, etc.)
export {
  // Board definition
  ArduinoUno,
  default as ArduinoUnoDefault,
  
  // Typed pins
  D0, D1, D2, D3, D4, D5, D6, D7,
  D8, D9, D10, D11, D12, D13,
  A0, A1, A2, A3, A4, A5,
  LED, SDA, SCL, MOSI, MISO, SCK, SS, TX, RX,
  
  // Peripheral bus instances
  I2C0, SPI0, UART0,
  
  // Timing / utility functions
  delay, millis, micros, delayMicroseconds, map, constrain,
  
  // Analog helpers
  AnalogReference, analogReference,
  
  // Interrupt helpers
  noInterrupts, interrupts, attachInterrupt, detachInterrupt,
  
  // Board namespace
  Board,
  type IBoard,
  type DigitalPins,
  type AnalogPins,
} from '@typecode/board-arduino-uno';