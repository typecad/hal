import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

const DEFAULT_FREQ_HZ = 5000;
const DEFAULT_BITS = 14;

export function pwmInitLines(): string[] {
  return [
    `// CUTTLEFISH_PWM_BEGIN`,
    `static ledc_timer_config_t __tc_ledc_timer = {`,
    `    .speed_mode = LEDC_LOW_SPEED_MODE,`,
    `    .duty_resolution = LEDC_TIMER_${DEFAULT_BITS}_BIT,`,
    `    .timer_num = LEDC_TIMER_0,`,
    `    .freq_hz = ${DEFAULT_FREQ_HZ},`,
    `    .clk_cfg = LEDC_AUTO_CLK,`,
    `};`,
    `static void __tc_ledc_init(void) { ledc_timer_config(&__tc_ledc_timer); }`,
    `// CUTTLEFISH_PWM_END`,
    ``,
  ];
}

const channelByPin = new Map<number, string>();
let nextChannelIdx = 0;
const CHANNEL_NAMES = [
  'LEDC_CHANNEL_0', 'LEDC_CHANNEL_1', 'LEDC_CHANNEL_2', 'LEDC_CHANNEL_3',
  'LEDC_CHANNEL_4', 'LEDC_CHANNEL_5', 'LEDC_CHANNEL_6', 'LEDC_CHANNEL_7',
];

export function resetPwmChannels(): void {
  channelByPin.clear();
  nextChannelIdx = 0;
}

function channelForPin(pin: number): string {
  if (!channelByPin.has(pin)) {
    if (nextChannelIdx >= CHANNEL_NAMES.length) {
      throw new Error(`framework-esp32: out of LEDC channels (max ${CHANNEL_NAMES.length})`);
    }
    channelByPin.set(pin, CHANNEL_NAMES[nextChannelIdx++]);
  }
  return channelByPin.get(pin)!;
}

/** Resolve a HAL pwm.* op to ESP-IDF C++ (LEDC). */
export function lowerPwm(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  switch (op.operation) {
    case 'pwm.write': {
      const ch = channelForPin(o.pin);
      return { code: `ledc_set_duty(LEDC_LOW_SPEED_MODE, ${ch}, ${o.duty}); ledc_update_duty(LEDC_LOW_SPEED_MODE, ${ch});` };
    }
    case 'pwm.get_frequency':
      return { expression: `${DEFAULT_FREQ_HZ}` };
    case 'pwm.get_resolution':
      return { expression: `${DEFAULT_BITS}` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
