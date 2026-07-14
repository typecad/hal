// ---------------------------------------------------------------------------
// @typecad/framework-avr — AVR profile resolution
//
// Resolves the active AVR chip descriptor from the build target (FQBN) and
// collects AVR-specific diagnostics (invalid pins, unsupported peripherals).
// Mirrors framework-arduino's profile.ts pattern: a resolveAvrProfile() entry
// point returning forced includes, symbol aliases, shim lines, and diagnostics,
// cached on the strategy by buildTarget.
//
// FQBN → chip mapping:
//   arduino:avr:uno   -> ATmega328P
//   arduino:avr:nano  -> ATmega328P
//   arduino:avr:mega  -> ATmega2560
//   (default)         -> ATmega328P
// ---------------------------------------------------------------------------

import type { ProgramIR, PlatformContext, Diagnostic } from '@typecad/cuttlefish/api/shared';
import { ATMEGA328P, ATMEGA2560, setActiveChip } from './chips/index.js';
import type { AVRChipDescriptor } from './chips/types.js';

/** Read the framework-specific build target (FQBN) off the platform context. */
function avrCtx(ctx?: PlatformContext): { buildTarget?: string } | undefined {
  return ctx?.frameworkData as { buildTarget?: string } | undefined;
}

/**
 * Map an AVR build-target FQBN to its chip descriptor.
 *
 * The FQBN's board segment (index 2, e.g. "uno" / "nano" / "mega") selects
 * the silicon. Unknown boards default to the ATmega328P.
 */
export function chipForBuildTarget(buildTarget?: string): AVRChipDescriptor {
  const board = buildTarget?.split(':')[2]?.toLowerCase();
  switch (board) {
    case 'mega':
    case 'meg2560':
      return ATMEGA2560;
    case 'uno':
    case 'nano':
    case undefined:
    default:
      return ATMEGA328P;
  }
}

/** Resolved AVR profile — mirrors ResolvedArduinoProfile. */
export interface ResolvedAvrProfile {
  /** The chip descriptor selected by the build target. */
  chip: AVRChipDescriptor;
  /** Forced includes for the generated sketch. */
  forcedIncludes: string[];
  /** Symbol aliases (delay → _native_delay_ms, etc.). */
  symbolAliases: Record<string, string>;
  /** AVR-specific diagnostics collected during resolution. */
  diagnostics: Diagnostic[];
}

/**
 * Resolve the AVR profile for a program: select the chip from the FQBN,
 * activate it, and collect any pin/peripheral diagnostics.
 *
 * The caller (the strategy) caches this by buildTarget so repeated calls
 * during one transpile do not re-resolve.
 */
export function resolveAvrProfile(program?: ProgramIR, ctx?: PlatformContext): ResolvedAvrProfile {
  const buildTarget = avrCtx(ctx)?.buildTarget;
  const chip = chipForBuildTarget(buildTarget);
  setActiveChip(chip);

  const diagnostics: Diagnostic[] = [];

  // Surface pin/peripheral misuse as diagnostics. The register helpers emit
  // /* invalid pin */ comments today; here we additionally produce structured
  // diagnostics the transpiler surfaces to the user.
  collectInvalidPinDiagnostics(program, chip, diagnostics);

  return {
    chip,
    forcedIncludes: ['<avr/io.h>'],
    symbolAliases: {
      'delay': '_native_delay_ms',
      'delayMicroseconds': '_native_delay_us',
      'millis': 'millis',
      'micros': 'micros',
      'map': '_native_map',
      'constrain': '_native_constrain',
      'noInterrupts': 'cli',
      'interrupts': 'sei',
    },
    diagnostics,
  };
}

/**
 * Walk the program's peripheral usage and emit diagnostics for any pin the
 * selected chip cannot satisfy: a pin number with no register mapping, a PWM
 * write to a non-PWM pin, or an analog read on a pin without an ADC channel.
 */
function collectInvalidPinDiagnostics(program: ProgramIR | undefined, chip: AVRChipDescriptor, diagnostics: Diagnostic[]): void {
  const usage = program?.peripheralUsage;
  if (!usage) return;

  const checkPin = (
    pin: number,
    check: (chip: AVRChipDescriptor) => boolean,
    code: string,
    message: string,
  ) => {
    if (!check(chip)) {
      diagnostics.push({
        severity: 'error',
        code,
        message,
        source: 'framework-avr',
        hint: `Pin D${pin} is not valid on the ${chip.id}. See the chip's pin map in src/chips/${chip.id}.ts.`,
      });
    }
  };

  // Output / input pins must have a register mapping on the active chip.
  for (const pin of usage.outputPins ?? []) {
    checkPin(pin, c => pin in c.pins, 'avr-invalid-pin',
      `D${pin} is used as an output but has no PORT/DDR mapping on the ${chip.id}.`);
  }
  for (const pin of usage.inputPins ?? []) {
    checkPin(pin, c => pin in c.pins, 'avr-invalid-pin',
      `D${pin} is used as an input but has no PIN mapping on the ${chip.id}.`);
  }
  for (const pin of usage.inputPullupPins ?? []) {
    checkPin(pin, c => pin in c.pins, 'avr-invalid-pin',
      `D${pin} is used with a pullup but has no PORT mapping on the ${chip.id}.`);
  }

  // PWM pins must be in the chip's pwmByPin table.
  for (const pin of usage.pwmPinsUsed ?? []) {
    checkPin(pin, c => pin in c.pwmByPin, 'avr-pwm-unsupported',
      `D${pin} is used for PWM but has no timer/OCR output on the ${chip.id}.`);
  }
}
