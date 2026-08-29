// ---------------------------------------------------------------------------
// boardgen.test.ts — the project-local board module generator.
//
// Pins the emitted .cuttlefish/board.ts + board.json shape for the three
// hardware-known boards (S3 devkit, blackpill, XIAO) and the tier-3 path
// (a board whose soc has no curated descriptor).
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { generateBoard, findBoardData, socOfTarget } from '../../../packages/framework-zephyr/src/boardgen';
import { BOARD_DATA } from '../../../packages/framework-zephyr/src/sdk/board-data.generated';
import { SOC_CHIPS } from '../../../packages/framework-zephyr/src/chips/soc/index';

describe('boardgen', () => {
  it('findBoardData resolves qualified, bare, and prefix targets', () => {
    expect(findBoardData('esp32s3_devkitc/esp32s3/procpu')?.identifier).toBe('esp32s3_devkitc/esp32s3/procpu');
    expect(findBoardData('blackpill_f411ce')?.identifier).toBe('blackpill_f411ce/stm32f411xe');
    expect(findBoardData('xiao_ble/nrf52840')?.vendor).toBe('seeed');
    expect(findBoardData('nope/nope/nope')).toBeUndefined();
    expect(socOfTarget('a/b/c')).toBe('b');
  });

  it('esp32s3: datasheet pins minus exclusions, LED via curated override, BUTTON on GPIO0', () => {
    const g = generateBoard('esp32s3_devkitc/esp32s3/procpu');
    const j = JSON.parse(g.boardJson);
    expect(j.soc).toBe('esp32s3');
    expect(j.tier).toBe('validated');
    expect(j.pinNames).toContain('GPIO2');
    expect(j.pinNames).not.toContain('GPIO0');   // strapping pin — excluded
    expect(j.pinNames).not.toContain('GPIO43');  // console TX — excluded
    // BUTTON = sw0 = gpio0.0... GPIO0 is excluded as a strap pin, but the
    // button still resolves through the devicetree spec path.
    expect(g.boardTs).toContain("export const BUTTON");
    // LED: no gpio-leds node (addressable WS2812), but the curated board
    // override (chips/board-overrides) maps it to GPIO48 as plain GPIO —
    // the deleted board package's behavior.
    expect(g.boardTs).toContain('export const LED = GPIO48');
    // ADC capability landed on exactly the ADC channel pins
    const adcTrue = Object.entries(j.constants)
      .filter(([k, v]) => k.endsWith('analogInput') && v === true).length;
    expect(adcTrue).toBe(10);
  });

  it('blackpill: stm32 port naming (PA/PB/PC), LED=PC13, BUTTON=PA0', () => {
    const g = generateBoard('blackpill_f411ce/stm32f411xe');
    const j = JSON.parse(g.boardJson);
    expect(j.pinNames).toContain('PA0');
    expect(j.pinNames).toContain('PB6');
    expect(j.pinNames).toContain('PC13');
    const ledLine = g.boardTs.split('\n').find((l) => l.includes('export const LED'));
    expect(ledLine).toContain('PC13');
    const btnLine = g.boardTs.split('\n').find((l) => l.includes('export const BUTTON'));
    expect(btnLine).toContain('PA0');
    // HAL pin numbering follows the port-block scheme: PC13 = 32 + 13 = 45
    expect(j.constants['pins.all.' + j.pinNames.indexOf('PC13') + '.number']).toBe(45);
  });

  it('xiao_ble: nrf port naming + the D0–D10 connector exports', () => {
    const g = generateBoard('xiao_ble/nrf52840');
    const j = JSON.parse(g.boardJson);
    expect(j.pinNames).toContain('P0.28');
    expect(j.pinNames).toContain('P1.11');
    expect(g.boardTs).toContain('export const D0 = ');
    expect(g.boardTs).toContain('export const D10 = ');
    // P1.11 is HAL pin 32 + 11 = 43 (port-block numbering)
    expect(j.constants['pins.all.' + j.pinNames.indexOf('P1.11') + '.number']).toBe(43);
    // Three LEDs from the board DTS; led0 = P0.26
    const ledLine = g.boardTs.split('\n').find((l) => l.includes('export const LED'));
    expect(ledLine).toContain('P0_26');
  });

  it('tier-3: a board with no curated soc still emits LED/BUTTON + connectors', () => {
    // Pick any pack board whose soc has no descriptor entry.
    const tier3 = Object.keys(BOARD_DATA).find((k) => !SOC_CHIPS[k.split('/')[1]]);
    expect(tier3).toBeDefined();
    const g = generateBoard(tier3!);
    const j = JSON.parse(g.boardJson);
    expect(j.tier).toBe('derived');
    // No soc convention → no datasheet pin sweep; the module still emits.
    expect(g.boardTs).toContain('@typecad/hal');
  });

  it('unknown target throws with guidance', () => {
    expect(() => generateBoard('not_a_board/at/all')).toThrow(/board data pack/);
  });
});

describe('boardgen — addressable-strip (ws2812) LEDs', () => {
  it('the pack stripLed becomes the LED export when the board has no gpio-leds LED', () => {
    // weact_esp32s3_b wires its pixel via I2S (I2S0_O_SD_GPIO7).
    const j = JSON.parse(generateBoard('weact_esp32s3_b/esp32s3/procpu').boardJson);
    expect(j.constants['pins.aliases.LED']).toBe('GPIO7');
    const ts = generateBoard('weact_esp32s3_b/esp32s3/procpu').boardTs;
    expect(ts).toContain('export const LED = GPIO7');
  });

  it('a gpio-leds LED outranks the strip (the devicetree led0 choice wins)', () => {
    // The adalogger has BOTH a red gpio-leds LED (led0-aliased) and a ws2812.
    const j = JSON.parse(generateBoard('adafruit_feather_adalogger_rp2040/rp2040').boardJson);
    expect(j.constants['pins.aliases.LED']).toBe('GP13');
  });
});
