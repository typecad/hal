// ---------------------------------------------------------------------------
// Pulse + shift lowering — bit-bang via GPIO + timing
//
// pulse.in measures the duration of a pulse (HIGH or LOW) on a GPIO pin by
// edge-polling with k_uptime_get. shift.out/in bit-bang a byte through a data
// + clock pin pair using gpio_pin_set + k_busy_wait. These are software
// implementations (no hardware pulse capture on nRF for the HAL surface); they
// are correct but not high-precision.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';
import { controllerNodelabelForPin, controllerRawPinForPin } from '../chips/controllers.js';

/** `DEVICE_DT_GET(DT_NODELABEL(<owning-controller>))` for a HAL pin. */
function devForPin(chip: ZephyrChipDescriptor, pin: number): string {
  return `DEVICE_DT_GET(DT_NODELABEL(${controllerNodelabelForPin(chip, pin)}))`;
}

/** Resolve a HAL pulse.* or shift.* op to Zephyr C++ (bit-bang). */
export function lowerPulseOrShift(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;

  switch (op.operation) {
    case 'pulse.in': {
      // Wait for the pin to reach `value`, then measure until it changes.
      // Edge-poll with k_uptime_get() (ms granularity — coarse but correct,
      // and 64-bit so it cannot wrap mid-measurement over ~49 days). The wait
      // for the start edge is bounded by the timeout; the measurement of the
      // pulse itself is intentionally unbounded (that IS the pulse length).
      // Returns -1 (0) if the start edge never arrives within the timeout.
      const pin = controllerRawPinForPin(chip, o.pin);
      const want = o.value;
      const dev = devForPin(chip, o.pin);
      const timeout = o.timeout ?? 1_000_000; // default 1s in us
      return {
        expression: `({ int64_t __max = static_cast<int64_t>(${timeout} / 1000); int64_t __t0 = k_uptime_get(); bool __ok = true; while (gpio_pin_get_raw(${dev}, ${pin}) != ${want}) { if ((k_uptime_get() - __t0) > __max) { __ok = false; break; } } int32_t __ret = 0; if (__ok) { int64_t __start = k_uptime_get(); while (gpio_pin_get_raw(${dev}, ${pin}) == ${want}) { } __ret = static_cast<int32_t>((k_uptime_get() - __start) * 1000); } __ret; })`,
      };
    }
    case 'pulse.in_long': {
      // Same as pulse.in but for long pulses. Previously this spun forever
      // with NO timeout (the comment claimed "no overflow concern" but the
      // real risk was hanging the thread on a stuck pin). Apply the same
      // timeout-bounded start-edge wait as pulse.in (bug Q5).
      const pin = controllerRawPinForPin(chip, o.pin);
      const want = o.value;
      const dev = devForPin(chip, o.pin);
      const timeout = o.timeout ?? 3_000_000; // default 3s in us (long pulses)
      return {
        expression: `({ int64_t __max = static_cast<int64_t>(${timeout} / 1000); int64_t __t0 = k_uptime_get(); bool __ok = true; while (gpio_pin_get_raw(${dev}, ${pin}) != ${want}) { if ((k_uptime_get() - __t0) > __max) { __ok = false; break; } } int32_t __ret = 0; if (__ok) { int64_t __start = k_uptime_get(); while (gpio_pin_get_raw(${dev}, ${pin}) == ${want}) { } __ret = static_cast<int32_t>((k_uptime_get() - __start) * 1000); } __ret; })`,
      };
    }
    case 'shift.out': {
      // Bit-bang `value` (MSB or LSB first) via dataPin + clockPin. The two
      // pins may sit on different GPIO controllers on multi-controller SoCs
      // (ESP32-S3), so each is resolved to its own owning controller.
      const dataPin = o.dataPin;
      const clockPin = o.clockPin;
      const dataDev = devForPin(chip, dataPin);
      const clockDev = devForPin(chip, clockPin);
      const msbFirst = o.bitOrder === 'msb';
      const init = msbFirst ? '7' : '0';
      const test = msbFirst ? '(__i >= 0)' : '(__i < 8)';
      const step = msbFirst ? '__i--' : '__i++';
      return {
        code: `for (int __i = ${init}; ${test}; ${step}) { gpio_pin_set_raw(${dataDev}, ${controllerRawPinForPin(chip, dataPin)}, (${o.value} >> __i) & 1); gpio_pin_set_raw(${clockDev}, ${controllerRawPinForPin(chip, clockPin)}, 1); k_busy_wait(1); gpio_pin_set_raw(${clockDev}, ${controllerRawPinForPin(chip, clockPin)}, 0); }`,
      };
    }
    case 'shift.in': {
      // Read 8 bits (MSB or LSB first) from dataPin, clocking on clockPin.
      const dataPin = o.dataPin;
      const clockPin = o.clockPin;
      const dataDev = devForPin(chip, dataPin);
      const clockDev = devForPin(chip, clockPin);
      const msbFirst = o.bitOrder === 'msb';
      const init = msbFirst ? '7' : '0';
      const test = msbFirst ? '(__i >= 0)' : '(__i < 8)';
      const step = msbFirst ? '__i--' : '__i++';
      const accum = msbFirst ? '__v = (__v << 1)' : '__v |= (bit << __i)';
      return {
        expression: `({ uint8_t __v = 0; for (int __i = ${init}; ${test}; ${step}) { gpio_pin_set_raw(${clockDev}, ${controllerRawPinForPin(chip, clockPin)}, 1); k_busy_wait(1); int bit = gpio_pin_get_raw(${dataDev}, ${controllerRawPinForPin(chip, dataPin)}); gpio_pin_set_raw(${clockDev}, ${controllerRawPinForPin(chip, clockPin)}, 0); ${accum}; } __v; })`,
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
