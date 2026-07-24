// ---------------------------------------------------------------------------
// @typecad/hal — RMT (Remote Control Transceiver) ergonomic API
// ---------------------------------------------------------------------------
// These wrappers accept an ergonomic `opts` object and forward to the positional
// semantic primitives in emit.ts. The HAL resolver collapses object literals to
// positional strings (dropping field names), so HALOpIR fields must be scalars;
// this wrapper destructures `opts` at the call site before the semantic call,
// giving users the ergonomic shape while keeping the IR flat. Mirrors how
// gpio.ts's Pin.pwm(duty) forwards to the positional pwmWrite(pin, duty).

import {
  rmtTxInit as _rmtTxInit,
  rmtRxInit as _rmtRxInit,
  rmtTxWriteBytes,
  rmtTxWriteSymbols,
  rmtTxWaitDone,
  rmtTxDeinit,
  rmtRxOnReceived,
  rmtRxStart,
  rmtRxStop,
  rmtRxRead,
  rmtRxDeinit,
} from './emit.js';

/** Initialize a TX channel on a pin. Idempotent per pin. Bit timings are fixed
 *  at init — ESP-IDF bakes them into the bytes-encoder at creation and exposes
 *  no public mutation API. Tick units are 1/resolutionHz seconds. */
export function rmtTxInit(
  pin: number | string,
  opts: {
    resolutionHz: number;
    /** [hiTicks, loTicks] for a logical 0 bit (e.g. WS2812: [4, 9] at 10MHz). */
    bit0: [number, number];
    /** [hiTicks, loTicks] for a logical 1 bit (e.g. WS2812: [9, 4] at 10MHz). */
    bit1: [number, number];
    /** Bit order; default false (LSB first — WS2812 style). */
    msbFirst?: boolean;
    /** TX transaction queue depth; default 4. */
    queueDepth?: number;
  },
): void {
  _rmtTxInit(
    pin,
    opts.resolutionHz,
    opts.bit0[0], opts.bit0[1],
    opts.bit1[0], opts.bit1[1],
    opts.msbFirst ?? false,
    opts.queueDepth ?? 4,
  );
}

/** Initialize an RX channel on a pin. Idempotent per pin. */
export function rmtRxInit(
  pin: number | string,
  opts: { resolutionHz: number },
): void {
  _rmtRxInit(pin, opts.resolutionHz);
}

export {
  rmtTxWriteBytes,
  rmtTxWriteSymbols,
  rmtTxWaitDone,
  rmtTxDeinit,
  rmtRxOnReceived,
  rmtRxStart,
  rmtRxStop,
  rmtRxRead,
  rmtRxDeinit,
};
