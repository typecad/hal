import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

// Tone uses LEDC TIMER_1 (separate from PWM's TIMER_0) and a dedicated channel
// pool starting after PWM's channels. This avoids conflicts with PWM.

export function toneInitLines(): string[] {
  const chip = getActiveChip();
  const maxPwmCh = chip.ledc.lowSpeedChannels;
  return [
    `// CUTTLEFISH_TONE_BEGIN`,
    `// Tone uses LEDC TIMER_1 + a dedicated channel (LEDC_CHANNEL_${maxPwmCh})`,
    `// to avoid conflicting with PWM channels on TIMER_0.`,
    `static int __tc_tone_pin = -1;`,
    `static ledc_channel_config_t __tc_tone_channel;`,
    `static void __tc_tone_play(int pin, int frequency, unsigned long duration) {`,
    `    // Configure tone timer (TIMER_1) for the requested frequency`,
    `    ledc_timer_config_t timer_cfg = {`,
    `        .speed_mode = LEDC_LOW_SPEED_MODE,`,
    `        .duty_resolution = LEDC_TIMER_10_BIT,`,
    `        .timer_num = LEDC_TIMER_1,`,
    `        .freq_hz = frequency > 0 ? frequency : 1,`,
    `        .clk_cfg = LEDC_AUTO_CLK,`,
    `    };`,
    `    ledc_timer_config(&timer_cfg);`,
    `    // Configure (or reconfigure) the tone channel`,
    `    __tc_tone_channel.gpio_num = pin;`,
    `    __tc_tone_channel.speed_mode = LEDC_LOW_SPEED_MODE;`,
    `    __tc_tone_channel.channel = LEDC_CHANNEL_${maxPwmCh};`,
    `    __tc_tone_channel.intr_type = LEDC_INTR_DISABLE;`,
    `    __tc_tone_channel.timer_sel = LEDC_TIMER_1;`,
    `    __tc_tone_channel.duty = (1 << 10) / 2;  // 50% duty at 10-bit`,
    `    __tc_tone_channel.hpoint = 0;`,
    `    ledc_channel_config(&__tc_tone_channel);`,
    `    __tc_tone_pin = pin;`,
    `    // Duration: if non-zero, schedule a stop via esp_timer (best-effort;`,
    `    // the main loop may not pump timers for very short durations).`,
    `    // For now, just play continuously; tone.stop is called explicitly.`,
    `    (void)duration;`,
    `}`,
    `static void __tc_tone_stop(int pin) {`,
    `    if (__tc_tone_pin == pin) {`,
    `        ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_${maxPwmCh}, 0);`,
    `        ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_${maxPwmCh});`,
    `        __tc_tone_pin = -1;`,
    `    }`,
    `}`,
    `// CUTTLEFISH_TONE_END`,
    ``,
  ];
}

/** Resolve a HAL tone.* op. Uses LEDC TIMER_1 + a dedicated channel. */
export function lowerTone(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'tone.play':
      return { code: `__tc_tone_play(${o.pin}, ${o.frequency}, ${o.duration ?? 0});` };
    case 'tone.stop':
      return { code: `__tc_tone_stop(${o.pin});` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
