// ---------------------------------------------------------------------------
// boardgen.test.ts — the project-local board module generator.
//
// One path for every board: the emitted .cuttlefish/board.ts + board.json
// derive entirely from the board's catalog record (DTS facts) — no curated
// descriptor tier, no strap-pin exclusions, no per-soc sweep overrides.
// Pins are swept from the derived controller table with soc-family naming;
// buses/USB/watchdog come from the board's own devicetree facts.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { generateBoard, findBoardData, socOfTarget } from '../../../packages/framework-zephyr/src/boardgen';
import { activeBoardCatalog } from '../../../packages/cuttlefish/src/board-catalog/store';
const CATALOG = activeBoardCatalog();

describe('boardgen', () => {
  it('findBoardData resolves qualified, bare, and prefix targets', () => {
    expect(findBoardData('esp32s3_devkitc/esp32s3/procpu')?.identifier).toBe('esp32s3_devkitc/esp32s3/procpu');
    expect(findBoardData('blackpill_f411ce')?.identifier).toBe('blackpill_f411ce/stm32f411xe');
    expect(findBoardData('xiao_ble/nrf52840')?.vendor).toBe('seeed');
    expect(findBoardData('nope/nope/nope')).toBeUndefined();
    expect(socOfTarget('a/b/c')).toBe('b');
  });

  it('esp32s3: full equal-path sweep (no strap-pin exclusions), BUTTON from the DTS', () => {
    const g = generateBoard('esp32s3_devkitc/esp32s3/procpu');
    const j = JSON.parse(g.boardJson);
    expect(j.soc).toBe('esp32s3');
    // All boards are equal: strap pins are swept like any other pad. Only
    // controllers the board DTS references are swept (gpio0 here — no fact
    // touches gpio1, so GPIO43 does not exist for this module).
    expect(j.pinNames).toContain('GPIO0');
    // The devicetree button resolves through the alias spec path.
    expect(g.boardTs).toContain('export const BUTTON');
    // The DTS has no gpio-leds node and no strip → no LED (honest).
    expect(g.boardTs).not.toContain('export const LED =');
    // Silicon capability flags are false for every board alike.
    const adcTrue = Object.entries(j.constants)
      .filter(([k, v]) => k.endsWith('analogInput') && v === true).length;
    expect(adcTrue).toBe(0);
    // The board DTS enables the UDC → the USB export + constants exist.
    expect(g.boardTs).toContain('export const USB0 = new USBConsole');
    expect(j.constants['zephyr.usb.controller']).toBe('zephyr_udc0');
  });

  it('blackpill: stm32 port naming (PA/PB/PC), LED=PC13, BUTTON=PA0', () => {
    const g = generateBoard('blackpill_f411ce/stm32f411xe');
    const j = JSON.parse(g.boardJson);
    // Only controllers the board DTS references are swept (gpioa/gpioc via
    // LED + button).
    expect(j.pinNames).toContain('PA0');
    expect(j.pinNames).toContain('PC13');
    const ledLine = g.boardTs.split('\n').find((l) => l.includes('export const LED'));
    expect(ledLine).toContain('PC13');
    const btnLine = g.boardTs.split('\n').find((l) => l.includes('export const BUTTON'));
    expect(btnLine).toContain('PA0');
    // HAL pin numbering follows the derived letter-port scheme: facts stay
    // at bits ≤ 15, so ports are 16 wide and sequential — gpioa 0–15,
    // gpioc 16–31 → PC13 = 16 + 13 = 29.
    expect(j.constants['pins.all.' + j.pinNames.indexOf('PC13') + '.number']).toBe(29);
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
    // led0 (P0.26) is the canonical LED — the DT numbering wins.
    const ledLine = g.boardTs.split('\n').find((l) => l.includes('export const LED'));
    expect(ledLine).toContain('P0_26');
  });

  it('boards with no LED/button facts still emit an honest module', () => {
    // Any catalog board with no DTS LED/button/connectors still resolves —
    // there is no curated tier to fall back on.
    const bare = Object.keys(CATALOG).find((k) => {
      const r = CATALOG[k];
      return !r.led && !r.button && !r.connectors && !r.stripLed;
    });
    expect(bare).toBeDefined();
    const g = generateBoard(bare!);
    expect(g.boardTs).toContain('@typecad/hal');
  });

  it('gpio<letter> ports widen to 32 bits when a fact uses bit ≥ 16', () => {
    // lp_mspm0g3519 is TI MSPM0: gpioa/gpiob are 32-bit ports sharing the
    // STM32-style names. Its led0 sits on gpiob.22 — a hard-coded 16-wide
    // range placed HAL pin 38 outside every controller, and the raw-GPIO
    // lowering fell back to the nonexistent `gpio0` nodelabel (undefined
    // __device_dts_ord_... at C++ compile time). The derived table must
    // cover the placed pin, and its controller-relative raw pin must be
    // the devicetree bit.
    const g = generateBoard('lp_mspm0g3519/mspm0g3519');
    const j = JSON.parse(g.boardJson);
    const ledIdx = j.pinNames.indexOf('PB22');
    expect(ledIdx).toBeGreaterThanOrEqual(0);
    const halPin = j.constants[`pins.all.${ledIdx}.number`];
    const controllers = Object.keys(j.constants)
      .filter((k) => /^\d+$/.test(k.replace('zephyr.gpioControllers.', '').replace(/\.nodelabel$/, '')) && k.startsWith('zephyr.gpioControllers'))
      .map((k) => {
        const i = Number(k.replace('zephyr.gpioControllers.', '').replace(/\.nodelabel$/, ''));
        return {
          nodelabel: j.constants[`zephyr.gpioControllers.${i}.nodelabel`],
          minPin: j.constants[`zephyr.gpioControllers.${i}.minPin`],
          maxPin: j.constants[`zephyr.gpioControllers.${i}.maxPin`],
        };
      });
    const owner = controllers.filter((c) => halPin >= c.minPin && halPin <= c.maxPin);
    expect(owner.map((c) => c.nodelabel)).toEqual(['gpiob']);
    expect(halPin - owner[0]!.minPin).toBe(22);
  });

  it('unknown target throws with guidance', () => {
    expect(() => generateBoard('not_a_board/at/all')).toThrow(/not a board target/);
  });

  it('bus + watchdog facts ride the board record into the manifest', () => {
    const g = generateBoard('nucleo_h753zi/stm32h753xx');
    const j = JSON.parse(g.boardJson);
    expect(j.constants['zephyr.i2c.controllers.0.nodeLabel']).toBeDefined();
    expect(j.constants['zephyr.uart.controllers.0.nodeLabel']).toBeDefined();
    expect(j.constants['zephyr.wdt.nodeLabel']).toBe('iwdg');
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

describe('boardgen — extra LEDs/buttons beyond the canonical first', () => {
  it('extra LED pins are declared + carried in pins.all (no dead aliases)', () => {
    // quick_feather: led0/led1/led2 = gpio 4/5/6, sw0 = gpio 0 — led1/led2
    // used to land in pinNames with no Pin.fromPort declaration and no
    // pins.all row (placed after both emission loops).
    const g = generateBoard('quick_feather/quicklogic_eos_s3');
    const j = JSON.parse(g.boardJson);
    expect(g.boardTs).toContain("export const GPIO4 = Pin.fromPort('GPIO4')");
    expect(g.boardTs).toContain("export const GPIO5 = Pin.fromPort('GPIO5')");
    expect(g.boardTs).toContain("export const GPIO6 = Pin.fromPort('GPIO6')");
    expect(g.boardTs).toContain('export const LED = GPIO4');
    expect(g.boardTs).toContain('export const BUTTON = GPIO0');
    expect(j.constants['pins.aliases.LED1']).toBe('GPIO5');
    expect(j.constants['pins.aliases.LED2']).toBe('GPIO6');
    // Manifest self-consistency: every pins.aliases value resolves to a
    // pins.all row — an alias naming a pin with no row is dead.
    const names = new Set(j.pinNames as string[]);
    for (const [k, v] of Object.entries(j.constants)) {
      if (!k.startsWith('pins.aliases.')) continue;
      expect(names.has(v as string)).toBe(true);
    }
    // …and every pinName has a pins.all row with a HAL number.
    j.pinNames.forEach((name: string, i: number) => {
      expect(typeof j.constants[`pins.all.${i}.number`]).toBe('number');
    });
  });
});
