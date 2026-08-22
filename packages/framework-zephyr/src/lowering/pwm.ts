// ---------------------------------------------------------------------------
// PWM lowering — pwm_dt_spec via pwm-led0 alias
//
// The XIAO nRF52840 exposes PWM via the `pwm-led0` devicetree alias (PWM_OUT0
// on P0.17, inverted). The lowering emits a `pwm_dt_spec` per channel and uses
// `pwm_set_pulse_dt` / `pwm_set_dt`. Duty is scaled from the Arduino-style
// 0–255 (or 0–1023) range to nanoseconds against the spec's period.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor, ZephyrPwmSpec } from '../chips/types.js';

/**
 * The DT alias a PWM spec is addressed by. Board-shipped specs carry their
 * alias in `dtSpec`; synthesized specs (controller + channel) get a
 * `tc-pwm<pin>` alias that the overlay generator creates in
 * <board>.overlay — both sides derive the name from the pin so they agree.
 */
export function pwmDtAlias(spec: ZephyrPwmSpec): string {
  return spec.dtSpec ?? `tc-pwm${spec.pin}`;
}

/**
 * The C macro token for a spec's alias. Zephyr's devicetree macros replace
 * dashes in alias names with underscores (`pwm-led0` in DTS is
 * DT_ALIAS(pwm_led0) in C) — the dashed spelling is a subtraction
 * expression and fails to compile (caught by the blackpill E2E west build).
 */
export function pwmDtAliasToken(spec: ZephyrPwmSpec): string {
  return pwmDtAlias(spec).replace(/-/g, '_');
}

/** Look up a PWM spec by HAL pin number. */
function findPwmSpec(chip: ZephyrChipDescriptor, pin: number): ZephyrPwmSpec | undefined {
  return chip.pwm?.specs.find((s) => s.pin === pin);
}

/** The C variable name emitted for a PWM channel's spec. */
function pwmVarName(spec: ZephyrPwmSpec): string {
  return `__tc_pwm_${pwmDtAliasToken(spec)}`;
}

/**
 * Emit the per-channel PWM spec declarations. One per spec in the chip
 * descriptor that the PROGRAM ACTUALLY DRIVES (`usedPins`) — a spec for an
 * untouched pin is unused code in the emitted TU (and would need a dead DT
 * alias in the overlay). When `usedPins` is omitted (probe paths with no
 * program), every spec is emitted. Called from shimLines when the program
 * uses PWM.
 */
export function pwmInitLines(chip: ZephyrChipDescriptor, usedPins?: ReadonlySet<number>): string[] {
  const lines: string[] = ['// CUTTLEFISH_PWM_BEGIN'];
  for (const spec of chip.pwm?.specs ?? []) {
    if (usedPins && !usedPins.has(spec.pin)) continue;
    lines.push(
      `static const struct pwm_dt_spec ${pwmVarName(spec)} = PWM_DT_SPEC_GET(DT_ALIAS(${pwmDtAliasToken(spec)}));`,
    );
  }
  lines.push('// CUTTLEFISH_PWM_END');
  return lines;
}

/**
 * Resolve a HAL pwm.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 */
export function lowerPwm(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  const spec = findPwmSpec(chip, o.pin);
  if (!spec) {
    // Probe / unlisted pin: return a comment so the resolver reports non-
    // undefined (the manifest validator's probe sends pin:0 with no spec).
    // A real program pins the descriptor's pwm.specs entry.
    return { code: `/* pwm on pin ${o.pin}: no PWM spec in chip descriptor */` };
  }
  const v = pwmVarName(spec);

  switch (op.operation) {
    case 'pwm.write': {
      // Duty is 0–255 (Arduino analogWrite). Scale to ns against the period.
      return { code: `pwm_set_pulse_dt(&${v}, (static_cast<uint32_t>(${o.duty}) * ${v}.period) / 255);` };
    }
    case 'pwm.get_frequency': {
      // period is in ns; frequency = 1e9 / period (Hz).
      return { expression: `(${v}.period ? (1000000000ULL / ${v}.period) : 0)` };
    }
    case 'pwm.get_resolution':
      // Arduino-compatible 8-bit duty range.
      return { expression: '8' };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
