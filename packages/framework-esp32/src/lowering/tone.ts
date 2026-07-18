import type { HALOpIR } from '@typecad/cuttlefish/api/shared';

export function toneInitLines(): string[] {
  return [
    `// CUTTLEFISH_TONE_BEGIN`,
    `// v1 stub: LEDC channel allocation for tone conflicts with the PWM pool.`,
    `// The helpers below are placeholders that do nothing; v1.1 will wire them`,
    `// to dedicated LEDC channels with frequency reconfiguration.`,
    `static void __tc_tone_play(int pin, int frequency, unsigned long duration) {`,
    `    (void)pin; (void)frequency; (void)duration;`,
    `}`,
    `static void __tc_tone_stop(int pin) { (void)pin; }`,
    `// CUTTLEFISH_TONE_END`,
    ``,
  ];
}

/** Resolve a HAL tone.* op. v1 is a documented stub (see README). */
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
