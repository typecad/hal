// ---------------------------------------------------------------------------
// Platform strategy re-export
//
// Most boards use the shared ArduinoStrategy from the CLI package.
// Board packages that need customized emit behavior can extend
// ArduinoStrategy and override specific methods here.
// ---------------------------------------------------------------------------

export { ArduinoStrategy as BoardStrategy } from 'typecode/platform';
