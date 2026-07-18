import { describe, it, expect } from 'vitest';
import { lowerTone, toneInitLines } from '../../../../packages/framework-esp32/src/lowering/tone';

describe('tone init block', () => {
  it('emits CUTTLEFISH_TONE markers + stub helpers', () => {
    const lines = toneInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_TONE_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_TONE_END');
    expect(lines).toContain('__tc_tone_play');
    expect(lines).toContain('__tc_tone_stop');
  });
});

describe('tone lowering (v1 stub)', () => {
  it('tone.play calls __tc_tone_play with pin, frequency, duration', () => {
    expect(lowerTone({ operation: 'tone.play', pin: 5, frequency: 440, duration: 200 }))
      .toEqual({ code: '__tc_tone_play(5, 440, 200);' });
  });
  it('tone.play without duration defaults to 0', () => {
    expect(lowerTone({ operation: 'tone.play', pin: 5, frequency: 440 }))
      .toEqual({ code: '__tc_tone_play(5, 440, 0);' });
  });
  it('tone.stop calls __tc_tone_stop', () => {
    expect(lowerTone({ operation: 'tone.stop', pin: 5 }))
      .toEqual({ code: '__tc_tone_stop(5);' });
  });
  it('unknown tone.* op throws', () => {
    expect(() => lowerTone({ operation: 'tone.unknown', pin: 5 } as any)).toThrow(/does not yet support/);
  });
});
