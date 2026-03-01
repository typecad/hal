// ---------------------------------------------------------------------------
// @typecode/board-arduino-uno — Platform strategy re-export
//
// The Arduino Uno uses the shared ArduinoStrategy from @typecode/cli.
// Board packages that need customized emit behavior can extend
// ArduinoStrategy and override specific methods here.
// ---------------------------------------------------------------------------

export { ArduinoStrategy as BoardStrategy } from 'typecode/platform';
