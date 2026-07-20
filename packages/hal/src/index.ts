// Re-export commonly-used types so consumers can import everything from @typecad/hal
//
// Runtime-contract interfaces (BasePin, II2CBus, ISPIBus, ISerialPort, the
// status enums, capability guards, PinCapabilityFlags, IToneAttachment, ...)
// now live in @typecad/simulator. Import them from there.
export type { DigitalValue, AnalogValue } from './types.js';
export { PinMode, InterruptMode } from './types.js';
export type { IPinGroup, PinGroupMember } from './types.js';
export { createPinGroup } from './types.js';

export type { InterruptHandler } from './types.js';

export type { ArchitectureIdentifier } from './types.js';

// Protocol-shape types (re-exported downstream by @typecad/framework-arduino)
export type { I2CAddress } from './types.js';
export type { SPIBitOrder, SPIMode, SPISettings } from './types.js';

export { include } from './include.js';
export { board } from './board.js';
export { callback } from './callback.js';
export { rawCpp, rawCppExpr, boardResolve } from './emit.js';
export { HIGH, LOW, OUTPUT, INPUT, INPUT_PULLUP, INPUT_PULLDOWN, OUTPUT_OPEN_DRAIN, ANALOG, LED_BUILTIN, LSBFIRST, MSBFIRST, WDTO_15MS, WDTO_30MS, WDTO_60MS, WDTO_120MS, WDTO_250MS, WDTO_500MS, WDTO_1S, WDTO_2S, WDTO_4S, WDTO_8S } from './constants.js';
export { delay, millis, micros, delayMicroseconds, map, constrain, TimingClass, Timing } from './timing.js';
export { freeHeap, setInterval, setTimeout, clearInterval, clearTimeout } from './timing.js';
export { abs, min, max, NumClass, Num, MapChain, ConstrainChain } from './math.js';
export { Pulse, pulseIn, pulseInLong } from './pulse.js';
export { Shift, shiftIn, shiftOut } from './shift.js';
export { Random } from './random.js';
export { randomSeed, random } from './random.js';
export { noInterrupts, interrupts, attachInterrupt, detachInterrupt } from './interrupts.js';
export { Pin, OutputPin, InputPin, ToneChain } from './gpio.js';
export { I2CBus, I2CDevice, i2cName } from './i2c.js';
export { SPIBus, SPIDevice, spiName } from './spi.js';
export { SerialPort, serialName } from './uart.js';
export { createHALInstances } from './utils.js';
// Register-mapped struct decorators (compile-time markers, erased by transpiler)
export type { Bit, Bits } from './register.js';
export { register, bits } from './register.js';
export { EEPROMClass, EEPROM } from './eeprom.js';
export { WDTClass, WDT } from './wdt.js';
export { ADCClass, ADC } from './adc.js';
export { DACClass, DAC } from './dac.js';
export { PreferencesClass, Preferences } from './preferences.js';
export { HardwareTimer, Timer0, Timer1, Timer2 } from './timer.js';
export { FSClass, FS } from './fs.js';
export { PowerClass, Power } from './power.js';
export { AsyncClass, Async } from './async.js';
export { WiFiClass, WiFi, WiFiStatus, WiFiEncryption } from './wifi.js';
export { HttpClass, Http, HttpRequest, HttpMethod } from './http.js';
