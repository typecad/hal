import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';

export function pwmInitLines(): string[] {
  const chip = getActiveChip();
  const bits = chip.ledc.timerBits;
  const freq = 5000;
  return [
    `// CUTTLEFISH_PWM_BEGIN`,
    `static ledc_timer_config_t __tc_ledc_timer = {`,
    `    .speed_mode = LEDC_LOW_SPEED_MODE,`,
    `    .duty_resolution = LEDC_TIMER_${bits}_BIT,`,
    `    .timer_num = LEDC_TIMER_0,`,
    `    .freq_hz = ${freq},`,
    `    .clk_cfg = LEDC_AUTO_CLK,`,
    `};`,
    `static bool __tc_ledc_ready = false;`,
    `static void __tc_ledc_init(void) {`,
    `    if (__tc_ledc_ready) return;`,
    `    ledc_timer_config(&__tc_ledc_timer);`,
    `    __tc_ledc_ready = true;`,
    `}`,
    `// CUTTLEFISH_PWM_END`,
    ``,
  ];
}

const channelByPin = new Map<number, string>();
const configuredPins = new Set<number>();
let nextChannelIdx = 0;

export function resetPwmChannels(): void {
  channelByPin.clear();
  configuredPins.clear();
  nextChannelIdx = 0;
}

function channelForPin(pin: number): string {
  if (!channelByPin.has(pin)) {
    const max = getActiveChip().ledc.lowSpeedChannels;
    if (nextChannelIdx >= max) {
      throw new Error(`framework-esp32: out of LEDC channels (max ${max} on ${getActiveChip().id})`);
    }
    channelByPin.set(pin, `LEDC_CHANNEL_${nextChannelIdx++}`);
  }
  return channelByPin.get(pin)!;
}

/** Resolve a HAL pwm.* op to ESP-IDF C++ (LEDC). */
export function lowerPwm(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  const chip = getActiveChip();
  switch (op.operation) {
    case 'pwm.write': {
      const ch = channelForPin(o.pin);
      const parts: string[] = ['__tc_ledc_init();'];
      if (!configuredPins.has(o.pin)) {
        configuredPins.add(o.pin);
        parts.push(
          `({ ledc_channel_config_t __tc_ch = {`
          + ` .gpio_num = ${o.pin}, .speed_mode = LEDC_LOW_SPEED_MODE,`
          + ` .channel = ${ch}, .timer_sel = LEDC_TIMER_0,`
          + ` .duty = 0, .hpoint = 0 };`
          + ` ledc_channel_config(&__tc_ch); })`,
        );
      }
      parts.push(
        `ledc_set_duty(LEDC_LOW_SPEED_MODE, ${ch}, ${o.duty});`,
        `ledc_update_duty(LEDC_LOW_SPEED_MODE, ${ch});`,
      );
      return { code: parts.join(' ') };
    }
    case 'pwm.get_frequency':
      return { expression: `5000` };
    case 'pwm.get_resolution':
      return { expression: `${chip.ledc.timerBits}` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
