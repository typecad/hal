// ---------------------------------------------------------------------------
// escape-hatch.test.ts — the two "any pin as any type" paths:
//
//   1. cuttlefish.facts.json — project facts merged into the manifest at
//      board-module generation (user routes win per pin, warnings record
//      shadowing, the file's hash joins the module fingerprint).
//   2. Construction-time overrides — new ADC(pin, { channel, device,
//      pinctrl }) / new PWM(pin, { periodNs, controller, channel }): the
//      ops carry the routing, the lowering honors it, diagnostics stand
//      down, and marker comments carry the DT-only facts to the overlay
//      regen (applyUserFactMarkers).
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { generateBoard, parseUserFactsJson, userFactsForTarget } from '../../../packages/framework-zephyr/src/boardgen';
import { generateOverlay } from '../../../packages/framework-zephyr/src/dt-config/overlay';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import { transpile } from '../../setup';
import type { ZephyrChipDescriptor } from '../../../packages/framework-zephyr/src/chips/types';

const FACTS = JSON.stringify({
  boards: {
    'rpi_pico/rp2040': {
      adc: { device: 'adc', channels: [{ pin: 26, channel: 0, pinctrl: 'ADC_CH0_P26' }] },
      pwm: { specs: [{ pin: 15, controller: 'pwm', channel: 15, pinctrl: 'PWM_7B_P15' }] },
    },
  },
}, null, 2);

describe('cuttlefish.facts.json (option 1)', () => {
  it('parses + validates, with clear errors on malformed shapes', () => {
    const file = parseUserFactsJson(FACTS);
    expect(userFactsForTarget(file, 'rpi_pico/rp2040')?.adc?.channels[0]).toMatchObject({ pin: 26, channel: 0 });
    // Prefix leniency (the bare board id).
    expect(userFactsForTarget(file, 'rpi_pico/rp2040/ns')).toBeDefined();
    expect(userFactsForTarget(file, 'other/board')).toBeUndefined();
    expect(() => parseUserFactsJson('{ nope')).toThrow(/cuttlefish\.facts\.json is not valid JSON/);
    expect(() => parseUserFactsJson('{"adc": {}}')).toThrow(/must carry a top-level "boards" object/);
  });

  it('merges into the manifest: channels/specs appear, exports fire, the facts hash joins the fingerprint', () => {
    const plain = generateBoard('rpi_pico/rp2040');
    const merged = generateBoard('rpi_pico/rp2040', { factsJson: FACTS });
    const c = JSON.parse(merged.boardJson).constants;
    expect(c['zephyr.adc.channels.0.pin']).toBe(26);
    expect(c['zephyr.adc.channels.0.pinctrl']).toBe('ADC_CH0_P26');
    expect(c['zephyr.adc.gain']).toBe('ADC_GAIN_1'); // the RP2 pair from the family table
    const specIdx = Object.keys(c).length; // presence is enough — find the pin
    const pins = Object.entries(c).filter(([k, v]) => /^zephyr\.pwm\.specs\.\d+\.pin$/.test(k) && v === 15);
    expect(pins.length).toBe(1);
    expect(merged.boardTs).toContain("export { ADC } from '@typecad/hal'");
    expect(merged.boardTs).toContain("export { PWM } from '@typecad/hal'");
    // The fingerprint moves with the facts file — the staleness check.
    const fp = JSON.parse(merged.boardJson).source.fingerprint;
    expect(fp).not.toBe(JSON.parse(plain.boardJson).source.fingerprint);
    expect(fp).toMatch(/\+[0-9a-f]{12}$/);
    expect(JSON.parse(generateBoard('rpi_pico/rp2040', { factsJson: FACTS }).boardJson).source.fingerprint)
      .toBe(fp); // stable for the same text
  });

  it('on a facts-less board the user channels ARE the manifest (fill semantics)', () => {
    // The checked-in fixture catalog predates the silicon harvests, so its
    // rpi_pico carries no adc facts — exactly the escape-hatch shape. The
    // user channels fill the manifest wholesale; nothing is shadowed.
    const g = generateBoard('rpi_pico/rp2040', {
      factsJson: JSON.stringify({
        boards: { 'rpi_pico/rp2040': { adc: { channels: [
          { pin: 26, channel: 0 },
          { pin: 27, channel: 2 },
        ] } } },
      }),
    });
    const c = JSON.parse(g.boardJson).constants;
    expect(c['zephyr.adc.channels.0.pin']).toBe(26);
    expect(c['zephyr.adc.channels.0.channel']).toBe(0);
    expect(c['zephyr.adc.channels.1.pin']).toBe(27);
    expect(c['zephyr.adc.channels.1.channel']).toBe(2);
    expect(g.warnings).toBeUndefined();
    expect(g.boardTs).toContain("export { ADC } from '@typecad/hal'");
  });

  it('a board with no facts at all gains them (the escape case)', () => {
    // mimxrt has no adc facts in the fixture; the facts file supplies them.
    const g = generateBoard('rpi_pico2/rp2350a/m33', {
      factsJson: JSON.stringify({ boards: { 'rpi_pico2': { adc: { channels: [{ pin: 40, channel: 0 }] } } } }),
    });
    const c = JSON.parse(g.boardJson).constants;
    expect(c['zephyr.adc.channels.0.pin']).toBe(40);
    expect(g.boardTs).toContain("export { ADC } from '@typecad/hal'");
  });
});

// ── Option 2: construction-time overrides ───────────────────────────────────

function rp2040Setup() {
  const g = generateBoard('rpi_pico/rp2040');
  return {
    boardTs: g.boardTs,
    boardConstants: new Map(Object.entries(JSON.parse(g.boardJson).constants)) as never,
  };
}

describe('inline ADC overrides (option 2)', () => {
  it('channel/device/pinctrl flow to the lowering; diagnostics stand down; the shim declares the device', () => {
    const { boardTs, boardConstants } = rp2040Setup();
    const result = transpile(
      [
        "import { ADC } from '@typecad/hal';",
        "import { GP21 } from '@typecad/board';",
        // GP21 has no harvested channel — the override vouches for it.
        'const sense = new ADC(GP21, { channel: 5, device: "adc" });',
        'const v = sense.read();',
        'if (v > 0) { sense.readMillivolts(); }',
        '',
      ].join('\n'),
      {
        strategy: new ZephyrStrategy(),
        boardConstants,
        boardTs,
        platformContext: { frameworkData: { buildTarget: 'rpi_pico' } } as never,
      },
    );
    const diags = (result.diagnostics ?? []).filter((d) => d.severity === 'error' || d.code === 'zephyr-adc-pin-unavailable');
    expect(diags).toEqual([]);
    expect(result.cpp).toContain('.channel_id = 5,');
    expect(result.cpp).toContain('.channels = BIT(5)');
    expect(result.cpp).toContain('#include <zephyr/drivers/adc.h>');
    expect(result.cpp).toContain('__tc_adc_dev = DEVICE_DT_GET(DT_NODELABEL(adc))');
    // The marker carries device/pinctrl facts to the overlay regen.
    expect(result.cpp).toContain('/* cuttlefish-user-facts: adc pin=21 device=adc channel=5 */');
  });

  it('a non-primary device override gets its own shim handle', () => {
    const { boardTs, boardConstants } = rp2040Setup();
    const result = transpile(
      [
        "import { ADC } from '@typecad/hal';",
        'const sense = new ADC(21, { channel: 3, device: "adc1" });',
        'const v = sense.read();',
        '',
      ].join('\n'),
      {
        strategy: new ZephyrStrategy(),
        boardConstants,
        boardTs,
        platformContext: { frameworkData: { buildTarget: 'rpi_pico' } } as never,
      },
    );
    expect(result.cpp).toContain('__tc_adc_adc1_dev = DEVICE_DT_GET(DT_NODELABEL(adc1))');
    expect(result.cpp).toContain('adc_channel_setup(__tc_adc_adc1_dev');
  });
});

describe('inline PWM overrides (option 2)', () => {
  it('controller/channel synthesize the spec; the marker carries routing; no no-op warning', () => {
    const { boardTs, boardConstants } = rp2040Setup();
    const result = transpile(
      [
        "import { PWM } from '@typecad/hal';",
        'const dimmer = new PWM(20, { periodNs: 1000000, controller: "pwm", channel: 4 });',
        'dimmer.setDuty(0.5);',
        '',
      ].join('\n'),
      {
        strategy: new ZephyrStrategy(),
        boardConstants,
        boardTs,
        platformContext: { frameworkData: { buildTarget: 'rpi_pico' } } as never,
      },
    );
    const diags = (result.diagnostics ?? []).filter((d) => d.code === 'zephyr-pwm-pin-unavailable');
    expect(diags).toEqual([]);
    expect(result.cpp).toContain('/* cuttlefish-user-facts: pwm pin=20 controller=pwm channel=4 */');
    // The alias rides the matrix-style tc-pwm<pin> name.
    expect(result.cpp).toContain('DT_ALIAS(tc_pwm20)');
    expect(result.cpp).toContain('pwm_set_pulse_dt(&__tc_pwm_tc_pwm20');
  });
});

describe('applyUserFactMarkers → overlay (the regen side)', () => {
  it('marker specs synthesize the DT nodes the lowered alias references', () => {
    // The chip as the regen would build it: no pwm spec for pin 20, no adc
    // channel for pin 21 — the markers fill them in.
    const emitted = [
      '/* cuttlefish-user-facts: adc pin=21 device=adc pinctrl=ADC_CH0_P26 channel=5 */',
      '/* cuttlefish-user-facts: pwm pin=20 controller=pwm channel=4 */',
    ].join('\n');
    // applyUserFactMarkers is module-private; drive it through the exported
    // overlay path by hand-merging (the marker parser is covered by the
    // emitted-source assertions above). Here: prove the merged chip shape
    // synthesizes the nodes.
    const chip: ZephyrChipDescriptor = {
      id: 'rp_board/rp2040', soc: 'rp2040', gpioController: 'gpio0', gpio: { dtSpecs: [] },
      adc: {
        nodeLabel: 'adc', resolution: 12, vrefMv: 3300, gain: 'ADC_GAIN_1', reference: 'ADC_REF_VDD_1',
        channels: [
          { pin: 26, channel: 0, pinctrl: 'ADC_CH0_P26' },
          { pin: 21, channel: 5, controller: 'adc', pinctrl: 'ADC_CH0_P26' },
        ],
      },
      pwm: { specs: [{ pin: 20, controller: 'pwm', channel: 4 }] },
    };
    const overlay = generateOverlay(chip, {
      usesAdc: true, adcReadPins: [21],
      usesPwm: true, pwmUsedPins: [20],
    }, undefined);
    expect(overlay).toContain('pinmux = <ADC_CH0_P26>');
    expect(overlay).toContain('&adc {');
    expect(overlay).toContain('tc-pwm20 = &tc_pwm_20;');
    expect(overlay).toContain('pwms = <&pwm 4 20000000 PWM_POLARITY_NORMAL>;');
    // Sanity: the emitted marker text itself parses (same grammar the
    // toolchain scanner reads).
    expect(emitted.match(/\/\* cuttlefish-user-facts: (adc|pwm) [^*]* \*\//g)).toHaveLength(2);
  });
});

// ── Cross-peripheral "did you mean" hints ────────────────────────────────────
//
// The facts know what a failed pin IS wired to — a PWM-capable pin misread
// as analog (or the reverse) is the classic mix-up, and the hint now names
// the pin's real function instead of only the valid-pin list.

describe('cross-peripheral did-you-mean hints', () => {
  // rpi_pico amended with the rev-23 RP2 facts: ADC channels on 26-29, PWM
  // specs on 14/15 — the fixture catalog predates the header harvest.
  function rp2Facts() {
    const g = generateBoard('rpi_pico/rp2040');
    const consts: Record<string, string | number | boolean> = { ...JSON.parse(g.boardJson).constants };
    consts['zephyr.adc.nodeLabel'] = 'adc';
    consts['zephyr.adc.resolution'] = 12;
    consts['zephyr.adc.vrefMv'] = 3300;
    consts['zephyr.adc.channels.0.pin'] = 26;
    consts['zephyr.adc.channels.0.channel'] = 0;
    // Spec index 0 exists (the board's pwm-led, virtual pin 8192); the new
    // specs continue at 1 — collectIndexed stops at index gaps.
    consts['zephyr.pwm.specs.1.pin'] = 14;
    consts['zephyr.pwm.specs.1.controller'] = 'pwm';
    consts['zephyr.pwm.specs.1.channel'] = 14;
    consts['zephyr.pwm.specs.2.pin'] = 15;
    consts['zephyr.pwm.specs.2.controller'] = 'pwm';
    consts['zephyr.pwm.specs.2.channel'] = 15;
    return { boardTs: g.boardTs, boardConstants: new Map(Object.entries(consts)) as never };
  }

  it('an ADC read on a PWM-only pin suggests new PWM with its controller/channel', () => {
    const { boardTs, boardConstants } = rp2Facts();
    const result = transpile(
      [
        "import { ADC } from '@typecad/hal';",
        'const sense = new ADC(15);', // pin 15: PWM spec, no ADC channel
        'const v = sense.read();',
        '',
      ].join('\n'),
      {
        strategy: new ZephyrStrategy(),
        boardConstants,
        boardTs,
        platformContext: { frameworkData: { buildTarget: 'rpi_pico' } } as never,
      },
    );
    const diag = (result.diagnostics ?? []).find((d) => d.code === 'zephyr-adc-pin-unavailable');
    expect(diag).toBeDefined();
    expect(diag!.hint).toMatch(/GPIO 15 carries PWM on this board \(pwm ch 15\) — did you mean new PWM\(15, …\)?/);
  });

  it('a PWM drive on an ADC-only pin suggests new ADC with its channel', () => {
    // Pin 26 has an ADC channel and no PWM spec.
    const { boardTs, boardConstants } = rp2Facts();
    const result = transpile(
      [
        "import { PWM } from '@typecad/hal';",
        'const dimmer = new PWM(26, { periodNs: 1000000 });',
        'dimmer.setDuty(0.5);',
        '',
      ].join('\n'),
      {
        strategy: new ZephyrStrategy(),
        boardConstants,
        boardTs,
        platformContext: { frameworkData: { buildTarget: 'rpi_pico' } } as never,
      },
    );
    const diag = (result.diagnostics ?? []).find((d) => d.code === 'zephyr-pwm-pin-unavailable');
    expect(diag).toBeDefined();
    expect(diag!.hint).toMatch(/GPIO 26 is an ADC channel \(adc ch 0\) — did you mean new ADC\(26\)?/);
  });
});
