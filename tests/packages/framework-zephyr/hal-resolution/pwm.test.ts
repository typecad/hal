import { describe, it, expect } from 'vitest';
import { lowerPwm, pwmInitLines, pwmDtAlias } from '../../../../packages/framework-zephyr/src/lowering/pwm';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';
import { ESP32S3_DEVKITC } from '../../../../packages/framework-zephyr/src/chips/esp32s3';
import { SOC_CHIPS } from '../../../../packages/framework-zephyr/src/chips/soc/index';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { ZephyrChipDescriptor } from '../../../../packages/framework-zephyr/src/chips/types';

// Synthesized-spec chip (the Black Pill shape): pwm4 controller + channel,
// no board-shipped DT alias — the overlay generator creates tc-pwm<pin>.
const BLACKPILL_PWM: ZephyrChipDescriptor = {
  id: 'blackpill_f411ce/stm32f411xe', soc: 'stm32f411', gpioController: 'gpioa',
  gpio: { dtSpecs: [] },
  pwm: {
    specs: [
      { pin: 22, controller: 'pwm4', channel: 1, periodNs: 20_000_000 },  // PB6 (TIM4_CH1)
      { pin: 23, controller: 'pwm4', channel: 2 },                         // PB7 (TIM4_CH2)
    ],
  },
};

describe('pwm init block', () => {
  it('emits CUTTLEFISH_PWM markers + a pwm_dt_spec per channel', () => {
    const lines = pwmInitLines(XIAO_BLE).join('\n');
    expect(lines).toContain('// CUTTLEFISH_PWM_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_PWM_END');
    // The alias token is macro-safe (dashes → underscores): the DT alias is
    // `pwm-led0` but Zephyr's generated macro is DT_N_ALIAS_pwm_led0 — the
    // dashed spelling DT_ALIAS(pwm-led0) is a subtraction expression and
    // fails to compile (found by the blackpill E2E west build).
expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(pwm_led0))');
    expect(lines).not.toContain('DT_ALIAS(pwm-led0)');
    expect(lines).toContain('__tc_pwm_pwm_led0');
  });
});

describe('per-use PWM spec gating', () => {
  it('emits specs only for the pins the program drives', () => {
    const used = new Set<number>([22]);
    const lines = pwmInitLines(BLACKPILL_PWM, used).join('\n');
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm22))');
    expect(lines).not.toContain('tc_pwm23');
  });

  it('emits every spec when no usage set is given (probe path)', () => {
    const lines = pwmInitLines(BLACKPILL_PWM).join('\n');
    expect(lines).toContain('tc_pwm22');
    expect(lines).toContain('tc_pwm23');
  });
});

describe('pwm lowering', () => {
  // The XIAO pwm-led0 spec is on pin 17.
  it('pwm.tone re-times the channel to the square-wave period at 50% duty', () => {
    const out = lowerPwm({ operation: 'pwm.tone', pin: 17, hz: 440 } as any, XIAO_BLE);
    expect(out.code).toBe('{ uint32_t __p = (440 > 0) ? static_cast<uint32_t>(1000000000ULL / static_cast<uint64_t>(440)) : 0U; (void)pwm_set_dt(&__tc_pwm_pwm_led0, __p, __p / 2U); }');
  });

  it('pwm.get_frequency → 1e9 / period (expression)', () => {
    const out = lowerPwm({ operation: 'pwm.get_frequency', pin: 17 } as any, XIAO_BLE);
    expect(out.expression).toBe('(__tc_pwm_pwm_led0.period ? (1000000000ULL / __tc_pwm_pwm_led0.period) : 0)');
  });

  it('pwm.get_resolution → 8 (Arduino 8-bit duty range)', () => {
    expect(lowerPwm({ operation: 'pwm.get_resolution', pin: 17 } as any, XIAO_BLE))
      .toEqual({ expression: '8' });
  });

  it('unmapped pin → comment (no spec in chip descriptor)', () => {
    const out = lowerPwm({ operation: 'pwm.write', pin: 99, duty: 50 } as any, XIAO_BLE);
    expect(out.code).toContain('no PWM spec');
  });
});

describe('pwm capability constants (match the transpiler constant fold)', () => {
  // getPwmFrequency()/getPwmResolution() constant-fold to the MCU manifest's
  // peripherals.pwm.maxFrequency/resolution; the runtime lowering must return
  // the SAME numbers or a folded literal and a runtime call disagree
  // (Black Pill fold: 50 MHz / 16-bit vs the old lowering's 50 Hz / 8).
  const CHIP = {
    ...XIAO_BLE,
    pwm: { ...XIAO_BLE.pwm!, maxFrequencyHz: 50_000_000, resolutionBits: 16 },
  };

  it('pwm.get_frequency → the declared max frequency when the descriptor carries one', () => {
    const out = lowerPwm({ operation: 'pwm.get_frequency', pin: 17 } as any, CHIP as any);
    expect(out.expression).toBe('50000000');
  });

  it('pwm.get_resolution → the declared resolution when the descriptor carries one', () => {
    const out = lowerPwm({ operation: 'pwm.get_resolution', pin: 17 } as any, CHIP as any);
    expect(out.expression).toBe('16');
  });
});

describe('synthesized PWM specs (Black Pill — overlay-generated aliases)', () => {
  it('addresses the channel via the tc-pwm<pin> alias the overlay creates', () => {
    const lines = pwmInitLines(BLACKPILL_PWM).join('\n');
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm22))');
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm23))');
    expect(lines).toContain('__tc_pwm_tc_pwm22');
  });

  it('pwm.tone drives the synthesized spec with the same code shape as aliased specs', () => {
    const out = lowerPwm({ operation: 'pwm.tone', pin: 22, hz: 440 } as any, BLACKPILL_PWM);
    expect(out.code).toContain('pwm_set_dt(&__tc_pwm_tc_pwm22, __p, __p / 2U)');
  });

  it('pwmDtAlias derives the pin-keyed alias only for the synthesized form', () => {
    expect(pwmDtAlias({ pin: 22, controller: 'pwm4', channel: 1 })).toBe('tc-pwm22');
    expect(pwmDtAlias({ pin: 17, dtSpec: 'pwm-led0' })).toBe('pwm-led0');
  });
});

// Matrix PWM (ESP32 LEDC): any matrix pin synthesizes a spec at build time —
// the C++ addresses the pin only via its tc-pwm<pin> alias; the channel lives
// in the DT pwms cell (assigned by emitPwmNodes over the driven pins).
describe('matrix PWM (ESP32-S3 LEDC)', () => {
  it('pwm.tone resolves a matrix pin to the tc-pwm<pin> alias spec', () => {
    const out = lowerPwm({ operation: 'pwm.tone', pin: 4, hz: 440 } as any, ESP32S3_DEVKITC);
    expect(out.code).toContain('pwm_set_dt(&__tc_pwm_tc_pwm4, __p, __p / 2U)');
  });

  it('pins outside the matrix (USB/flash/console pads) stay a comment', () => {
    const out = lowerPwm({ operation: 'pwm.tone', pin: 19, hz: 440 } as any, ESP32S3_DEVKITC);
    expect(out.code).toContain('no PWM spec');
  });

  it('emits alias vars for exactly the driven matrix pins, ascending', () => {
    const lines = pwmInitLines(ESP32S3_DEVKITC, new Set<number>([12, 4])).join('\n');
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm4))');
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm12))');
    expect(lines).not.toContain('tc_pwm5');
  });

  it('emits every matrix pin when no usage set is given (probe path)', () => {
    const lines = pwmInitLines(ESP32S3_DEVKITC).join('\n');
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm1))');
    expect(lines).toContain('PWM_DT_SPEC_GET(DT_ALIAS(tc_pwm48))');
  });
});

// ---------------------------------------------------------------------------
// Board pwm-led specs — the board's own devicetree alias (pwm-led0) joined
// into the active chip from the generated board manifest, no overlay.
// ---------------------------------------------------------------------------

describe('board pwm-led specs (pack facts join the chip)', () => {
  it('boardPwmSpecsFromConstants reads the virtual-pin specs boardgen emits', async () => {
    const { boardPwmSpecsFromConstants, mergeBoardPwmSpecs } = await import('../../../../packages/framework-zephyr/src/chips/resolve');
    const g = generateBoard('adafruit_itsybitsy_m4_express/samd51g19a');
    const bc = new Map(Object.entries(JSON.parse(g.boardJson).constants));
    const specs = boardPwmSpecsFromConstants(bc);
    expect(specs).toEqual([{ pin: 8192, dtSpec: 'pwm-led0' }]);
    // Merging into a chip with no conflicting spec appends it.
    const chip = { id: 't', soc: 'samd51g19a', gpioController: 'porta', gpio: { dtSpecs: [] }, pwm: { specs: [{ pin: 4, controller: 'tcc0', channel: 0 }] } } as any;
    const merged = mergeBoardPwmSpecs(chip, specs);
    expect(merged.pwm.specs).toHaveLength(2);
    expect(merged.pwm.specs[1]).toEqual({ pin: 8192, dtSpec: 'pwm-led0' });
  });

  it('a curated dtSpec collision drops the board spec (the curated entry wins)', async () => {
    const { mergeBoardPwmSpecs } = await import('../../../../packages/framework-zephyr/src/chips/resolve');
    const xiao = SOC_CHIPS['nrf52840'];
    const merged = mergeBoardPwmSpecs(xiao!, [{ pin: 8192, dtSpec: 'pwm-led0' }]);
    expect(merged.pwm.specs.filter((s) => s.dtSpec === 'pwm-led0')).toHaveLength(1);
    // Pin collision also drops (a virtual pin never collides in practice,
    // but the guard must hold for curated pins).
    expect(mergeBoardPwmSpecs(xiao!, [{ pin: merged.pwm.specs[0].pin, controller: 'pwm0', channel: 9 }]).pwm.specs)
      .toBe(xiao!.pwm.specs);
  });

  it('the emitted C++ addresses the board pwm-led via its own DT alias', async () => {
    // The itsybitsy M4 (tier-3 samd51): boardgen emits the board's pwm-led0
    // spec on virtual pin 8192; the lowering addresses it through the
    // board's own DT alias — no overlay involved.
    const { boardPwmSpecsFromConstants } = await import('../../../../packages/framework-zephyr/src/chips/resolve');
    const g = generateBoard('adafruit_itsybitsy_m4_express/samd51g19a');
    const bc = new Map(Object.entries(JSON.parse(g.boardJson).constants));
    const specs = boardPwmSpecsFromConstants(bc);
    expect(specs).toEqual([{ pin: 8192, dtSpec: 'pwm-led0' }]);
    const lines = pwmInitLines(
      { id: 't', soc: 'samd51g19a', gpioController: 'porta', gpio: { dtSpecs: [] }, pwm: { specs } } as any,
      new Set([8192]),
    );
    expect(lines.join('\n')).toContain('PWM_DT_SPEC_GET(DT_ALIAS(pwm_led0))');
  });
});
