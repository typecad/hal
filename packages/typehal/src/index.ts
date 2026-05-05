// Re-export commonly-used core types so consumers can import everything from @typehal/typehal
export type { IInputModePin, IOutputModePin, InterruptHandler, InterruptOptions, IToneAttachment } from '@typehal/core';

export { emit } from './emit';
export { include } from './include';
export { board } from './board';
export { callback } from './callback';
export { HIGH, LOW, OUTPUT, INPUT, INPUT_PULLUP, LED_BUILTIN, LSBFIRST, MSBFIRST, WDTO_15MS, WDTO_30MS, WDTO_60MS, WDTO_120MS, WDTO_250MS, WDTO_500MS, WDTO_1S, WDTO_2S, WDTO_4S, WDTO_8S } from './constants';
export { delay, millis, micros, delayMicroseconds, map, constrain, TimingClass, Timing } from './timing';
export { abs, min, max, NumClass, Num } from './math';
export { Pulse } from './pulse';
export { Shift } from './shift';
export { Random } from './random';
export { randomSeed, random } from './random';
export { Pin, OutputPin, InputPin, ToneChain } from './gpio';
export { I2CBus, i2cName } from './i2c';
export { SPIBus, spiName } from './spi';
export { SerialPort, serialName } from './uart';
export { EEPROMClass, EEPROM } from './eeprom';
export { WDTClass, WDT } from './wdt';
export { ADCClass, ADC } from './adc';
export { DACClass, DAC } from './dac';
export { PreferencesClass, Preferences } from './preferences';
export { HardwareTimer, Timer0, Timer1, Timer2 } from './timer';
export { FSClass, FS } from './fs';
export { PowerClass, Power } from './power';
