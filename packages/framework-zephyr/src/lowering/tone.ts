// ---------------------------------------------------------------------------
// Tone lowering — PWM-based square-wave generation
//
// tone is a convenience wrapper around PWM: a square wave at `frequency` Hz with
// a 50% duty cycle. The lowering maps frequency → period (ns) and sets the PWM
// channel to a 50% pulse. stop turns the output off (0% duty). The PWM spec is
// resolved from the chip descriptor (pwm-led0 on the XIAO).
//
// An optional duration is honored by scheduling a stop via k_sleep in a detached
// fashion — but the simple lowering is blocking (k_msleep(duration) then stop),
// matching the synchronous Arduino tone() semantics. For non-blocking tone,
// a workqueue would be needed (deferred).
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';
import { lowerPwm, pwmDtAliasToken } from './pwm.js';

/**
 * Resolve a HAL tone.* op to Zephyr C++ via PWM.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 */
export function lowerTone(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;

  switch (op.operation) {
    case 'tone.play': {
      // period_ns = 1e9 / freq; pulse_ns = period / 2 (50% duty).
      // Build a fake pwm.write would need the spec var directly; emit the
      // pwm_set_dt call against the same spec var the PWM lowering uses.
      const spec = chip.pwm?.specs[0];
      if (!spec) {
        return { code: `/* tone.play(${o.frequency}): no PWM spec in chip descriptor */` };
      }
      const v = `__tc_pwm_${pwmDtAliasToken(spec)}`;
      const freq = o.frequency;
      const duration = o.duration;
      // Braced: two tone ops in one statement-scope (e.g. tone(440).for(50)
      // lowers tone.play + tone.play_for back-to-back) would otherwise
      // redeclare __period.
      const setTone = `{ uint32_t __period = (${freq} > 0) ? (1000000000ULL / static_cast<uint64_t>(${freq})) : 0; pwm_set_dt(&${v}, __period, __period / 2); }`;
      if (duration !== undefined) {
        // Blocking tone for the requested duration, then stop.
        return { code: `${setTone} k_msleep(${duration}); pwm_set_pulse_dt(&${v}, 0);` };
      }
      return { code: setTone };
    }
    case 'tone.stop': {
      const spec = chip.pwm?.specs[0];
      if (!spec) return { code: `/* tone.stop: no PWM spec */` };
      const v = `__tc_pwm_${pwmDtAliasToken(spec)}`;
      return { code: `pwm_set_pulse_dt(&${v}, 0);` };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
