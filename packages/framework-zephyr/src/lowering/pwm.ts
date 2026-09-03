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

/**
 * Look up a PWM spec by HAL pin number. Matrix pins (ESP32 LEDC) synthesize
 * a spec on the fly: the channel is inert here — the emitted C++ addresses
 * the pin only via its `tc-pwm<pin>` alias (the DT pwms cell carries the
 * real channel, assigned by the overlay generator over the driven pins).
 */
export function findPwmSpec(chip: ZephyrChipDescriptor, pin: number): ZephyrPwmSpec | undefined {
  const spec = chip.pwm?.specs.find((s) => s.pin === pin);
  if (spec) return spec;
  const m = chip.pwm?.matrix;
  if (m && m.pins.includes(pin)) return { pin, controller: m.controller, channel: 0 };
  return undefined;
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
export function pwmInitLines(
  chip: ZephyrChipDescriptor,
  usedPins?: ReadonlySet<number>,
  userSpecs?: readonly { pin: number; controller: string; channel: number }[],
): string[] {
  const lines: string[] = ['// CUTTLEFISH_PWM_BEGIN'];
  for (const spec of chip.pwm?.specs ?? []) {
    if (usedPins && !usedPins.has(spec.pin)) continue;
    lines.push(
      `static const struct pwm_dt_spec ${pwmVarName(spec)} = PWM_DT_SPEC_GET(DT_ALIAS(${pwmDtAliasToken(spec)}));`,
    );
  }
  // Inline-override pins (the escape hatch): the construction opts vouch for
  // controller+channel on a pin the manifest does not map — the alias var
  // the lowered calls reference (the DT node itself comes from the overlay
  // regen's marker merge).
  for (const spec of userSpecs ?? []) {
    if (chip.pwm?.specs.some((s) => s.pin === spec.pin)) continue;
    if (usedPins && !usedPins.has(spec.pin)) continue;
    lines.push(
      `static const struct pwm_dt_spec ${pwmVarName(spec)} = PWM_DT_SPEC_GET(DT_ALIAS(${pwmDtAliasToken(spec)}));`,
    );
  }
  // Matrix pins (ESP32 LEDC): one alias per driven pin, ascending — the same
  // order the overlay generator assigns channels in, though the C++ never
  // needs the channel (the DT pwms cell carries it). An omitted usage set
  // (probe paths) emits every matrix pin, mirroring the static behavior.
  const m = chip.pwm?.matrix;
  if (m) {
    const pins = (usedPins ? [...usedPins].filter((p) => m.pins.includes(p)) : [...m.pins])
      .sort((a, b) => a - b);
    for (const pin of pins) {
      const spec: ZephyrPwmSpec = { pin, controller: m.controller, channel: 0 };
      lines.push(
        `static const struct pwm_dt_spec ${pwmVarName(spec)} = PWM_DT_SPEC_GET(DT_ALIAS(${pwmDtAliasToken(spec)}));`,
      );
    }
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
  // Construction-time controller/channel overrides (hal/pwm-pin.ts opts):
  // the user vouches for the routing. The spec synthesizes from the
  // override (addressing rides the tc-pwm<pin> alias like a matrix pin) and
  // a marker comment carries controller+channel to the overlay regen, which
  // synthesizes the DT node — the transpiler cannot.
  const hasOverride = (typeof o.controllerOverride === 'string' && o.controllerOverride !== '')
    || (typeof o.channelOverride === 'number' && o.channelOverride >= 0);
  const spec = hasOverride
    ? {
        pin: o.pin as number,
        controller: (o.controllerOverride as string | undefined) ?? 'pwm0',
        channel: (o.channelOverride as number | undefined) ?? 0,
      }
    : findPwmSpec(chip, o.pin);
  if (!spec) {
    // Probe / unlisted pin: return a comment so the resolver reports non-
    // undefined (the manifest validator's probe sends pin:0 with no spec).
    // A real program pins the descriptor's pwm.specs entry.
    return { code: `/* pwm on pin ${o.pin}: no PWM spec in chip descriptor */` };
  }
  const v = pwmVarName(spec);
  // The overlay regen (toolchain) parses this into a synthesized pwm-leds
  // spec: pin → controller/channel. Comment placement inside the block
  // braces is legal C.
  const marker = hasOverride
    ? `/* cuttlefish-user-facts: pwm pin=${spec.pin} controller=${spec.controller} channel=${spec.channel} */ `
    : '';

  switch (op.operation) {
    // ── Thin PWM (hal/pwm-pin.ts) — ns-true verbs ──────────────────────────
    // Zephyr 4.4 has pwm_set_dt (period + pulse) and pwm_set_pulse_dt (pulse
    // only) — no period-only setter. The construction period is established
    // once via pwm_set_dt(period, pulse 0 = line idle), then every set is one
    // pwm_set_pulse_dt. No 0–255 scaling anywhere.
    case 'pwm.set_pulse': {
      return {
        code: `{ ${marker}static bool __tc_pwm_p${o.pin}_prd = false; if (!__tc_pwm_p${o.pin}_prd) { (void)pwm_set_dt(&${v}, ${o.periodNs}, 0); __tc_pwm_p${o.pin}_prd = true; } (void)pwm_set_pulse_dt(&${v}, ${o.pulseNs}); }`,
      };
    }
    case 'pwm.set_duty': {
      // duty is 0.0–1.0; pulse = duty × the construction period.
      return {
        code: `{ ${marker}static bool __tc_pwm_p${o.pin}_prd = false; if (!__tc_pwm_p${o.pin}_prd) { (void)pwm_set_dt(&${v}, ${o.periodNs}, 0); __tc_pwm_p${o.pin}_prd = true; } (void)pwm_set_pulse_dt(&${v}, static_cast<uint32_t>(static_cast<double>(${o.duty}) * static_cast<double>(${o.periodNs}))); }`,
      };
    }
    case 'pwm.set_period': {
      // No period-only API: pwm_set_dt applies the new period and resets the
      // pulse to idle — follow with setPulse/setDuty to drive the line.
      return { code: `${marker}(void)pwm_set_dt(&${v}, ${o.periodNs}, 0);` };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
