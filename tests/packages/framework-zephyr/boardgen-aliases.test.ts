// ---------------------------------------------------------------------------
// boardgen-aliases.test.ts — pin alias coverage in the generated board
// manifest: connector labels (D0–D10, SDA/SCL, bus pins), indexed
// LED/BUTTON aliases (LED0/LED1/LED2), analogOffset, and the hal-parser's
// D/A resolution deferring to the alias map before Arduino arithmetic.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';
import { transpile } from '../../setup';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

describe('boardgen pin aliases', () => {
  it('XIAO: D0-D10 connector labels ride pins.aliases.* with the board wiring', () => {
    const j = JSON.parse(generateBoard('xiao_ble/nrf52840').boardJson);
    const c = j.constants;
    // D0 = gpio0.2 (NOT Arduino pin 0 — the alias carries the wiring).
    expect(c['pins.aliases.D0']).toBe('P0.02');
    expect(c['pins.aliases.D2']).toBe('P0.28');
    expect(c['pins.aliases.D10']).toBe('P1.15');
  });

  it('XIAO: indexed LED aliases line up with the dtSpec numbering', () => {
    const j = JSON.parse(generateBoard('xiao_ble/nrf52840').boardJson);
    const c = j.constants;
    // led0 (red), led1 (green), led2 (blue) — LED0 is the canonical first.
    expect(c['pins.aliases.LED']).toBe('P0.26');
    expect(c['pins.aliases.LED0']).toBe('P0.26');
    expect(c['pins.aliases.LED1']).toBe('P0.30');
    expect(c['pins.aliases.LED2']).toBe('P0.06');
  });

  it('esp32s2 feather (tier-3): connector labels resolve via controller-label derivation', () => {
    const j = JSON.parse(generateBoard('adafruit_feather_esp32s2_tft_reverse/esp32s2').boardJson);
    const c = j.constants;
    expect(c['pins.aliases.A0']).toBeDefined();
    expect(c['pins.aliases.SDA']).toBeDefined();
    expect(c['pins.aliases.SCK']).toBeDefined();
  });

  it('boards with A-labels get analogOffset', () => {
    const j = JSON.parse(generateBoard('adafruit_feather_adalogger_rp2040/rp2040').boardJson);
    expect(j.constants['pins.analogOffset']).toBeDefined();
    expect(j.constants['pins.aliases.A0']).toBe('GP26');
  });

  it('tier-3 blackpill f401ce: LED/BUTTON via controller-label derivation', () => {
    const j = JSON.parse(generateBoard('blackpill_f401ce/stm32f401xe').boardJson);
    expect(j.constants['pins.aliases.LED']).toBe('PC13');
    expect(j.constants['pins.aliases.BUTTON']).toBe('PA0');
  });

  it('all boards sweep strap pins equally (the BUTTON alias still resolves)', () => {
    const j = JSON.parse(generateBoard('esp32s3_devkitc/esp32s3/procpu').boardJson);
    expect(j.pinNames).toContain('GPIO0');
    expect(j.constants['pins.aliases.BUTTON']).toBeDefined();
  });
});

describe('boardgen tier-3 GPIO controller families', () => {
  const controllersOf = (manifest: { constants: Record<string, unknown> }): Record<string, { nodelabel: string; minPin: number }> => {
    const byN: Record<number, { nodelabel: string; minPin: number }> = {};
    for (const [k, v] of Object.entries(manifest.constants)) {
      const m = k.match(/^zephyr\.gpioControllers\.(\d+)\.(nodelabel|minPin)$/);
      if (m) (byN[Number(m[1])] ??= {} as { nodelabel: string; minPin: number })[m[2] as 'nodelabel' | 'minPin'] = v as string | number;
    }
    return Object.fromEntries(Object.values(byN).map((x) => [x.nodelabel, x]));
  };

  it('Renesas RA: ioport<N> are 16-pin ports, letters continue past 9 (ioporta = port 10)', () => {
    const j = JSON.parse(generateBoard('ek_ra8d1').boardJson);
    const ctrls = controllersOf(j);
    // ek_ra8d1 declares ioport0…ioport9 + ioporta.
    expect(ctrls['ioport0']?.minPin).toBe(0);
    expect(ctrls['ioporta']?.minPin).toBe(160);
    expect(j.constants['pins.aliases.LED']).toBe('P600'); // ioport6.0
    expect(j.constants['pins.aliases.BUTTON']).toBe('P009'); // ioport0.9
  });

  it('Cypress: gpio_prt<N> are 8-pin ports', () => {
    const j = JSON.parse(generateBoard('cy8ckit_062_wifi_bt/cy8c6247/m0').boardJson);
    const ctrls = controllersOf(j);
    expect(ctrls['gpio_prt0']?.minPin).toBe(0);
    expect(ctrls['gpio_prt13']?.minPin).toBe(104);
    expect(j.constants['pins.aliases.LED']).toBe('P13_7');
    expect(j.constants['pins.aliases.BUTTON']).toBe('P0_4');
  });

  it('Ambiq Apollo: range-encoded gpio<lo>_<hi> banks name the global pin', () => {
    const j = JSON.parse(generateBoard('apollo4p_blue_kxr_evb/apollo4p_blue').boardJson);
    const ctrls = controllersOf(j);
    expect(ctrls['gpio0_31']?.minPin).toBe(0);
    expect(ctrls['gpio64_95']?.minPin).toBe(64);
    expect(j.constants['pins.aliases.LED']).toBe('GPIO30');
    expect(j.constants['pins.aliases.LED2']).toBe('GPIO91'); // gpio64_95.27
  });

  it('NXP MCX/S32K: low/high register banks split each 32-pin port', () => {
    const j = JSON.parse(generateBoard('frdm_mcxe31b/mcxe31b').boardJson);
    const ctrls = controllersOf(j);
    expect(ctrls['gpiob_l']?.minPin).toBe(32);
    expect(ctrls['gpiob_h']?.minPin).toBe(48);
    expect(ctrls['gpioc_h']?.minPin).toBe(80);
    expect(j.constants['pins.aliases.LED']).toBe('PC16'); // gpioc_h.0
    expect(j.constants['pins.aliases.LED1']).toBe('PB22'); // gpiob_h.6
  });

  it('RP2350B: the gpio0_hi bank covers pins 32…', () => {
    const j = JSON.parse(generateBoard('pico_plus2/rp2350b/hazard3').boardJson);
    const ctrls = controllersOf(j);
    expect(ctrls['gpio0']?.minPin).toBe(0);
    expect(ctrls['gpio0_hi']?.minPin).toBe(32);
  });

  it('MPS2: dedicated gpio_led0/gpio_button FPGAIO IPs get opaque slots (no range collision)', () => {
    const j = JSON.parse(generateBoard('mps2/an385').boardJson);
    const ctrls = controllersOf(j);
    expect(ctrls['gpio_led0']?.minPin).toBeGreaterThanOrEqual(4096);
    expect(ctrls['gpio_button']?.minPin).toBeGreaterThanOrEqual(4096);
    expect(ctrls['gpio_led0']?.minPin).not.toBe(ctrls['gpio_button']?.minPin);
    expect(j.constants['pins.aliases.LED']).toBe('PLED0');
    expect(j.constants['pins.aliases.BUTTON']).toBe('PBUTTON0');
  });

  it('Atmel SAM tier-3: port<letter> 32-pin ports, datasheet PA names', () => {
    const j = JSON.parse(generateBoard('adafruit_feather_m4_express/samd51j19a').boardJson);
    const ctrls = controllersOf(j);
    expect(ctrls['porta']?.minPin).toBe(0);
    expect(j.constants['pins.aliases.LED']).toBe('PA23');
  });

  it('SiFli: letter + range controllers (gpioa_32_44) name the global pin', () => {
    const j = JSON.parse(generateBoard('pt2/sf32lb52jud6').boardJson);
    const ctrls = controllersOf(j);
    expect(ctrls['gpioa_32_44']?.minPin).toBe(32);
    expect(j.constants['pins.aliases.BUTTON']).toBe('GPIO34'); // base 32 + bit 2
  });

  it('GPIO expanders are excluded from the derived controller table', () => {
    // frdm_imx93 references both the SoC gpio2 and a gpio_exp0 expander —
    // only the SoC controller may appear in zephyr.gpioControllers.
    const j = JSON.parse(generateBoard('frdm_imx93/mimx9352/a55').boardJson);
    const ctrls = controllersOf(j);
    expect(ctrls['gpio2']?.minPin).toBe(64);
    expect(Object.keys(ctrls)).not.toContain('gpio_exp0');
  });

  it('flat gpio controller boards place LED/BUTTON on the single bank', () => {
    const j = JSON.parse(generateBoard('v2m_musca_b1/musca_b1').boardJson);
    const ctrls = controllersOf(j);
    expect(ctrls['gpio']?.minPin).toBe(0);
    // devicetree led0 = &green_led (gpio 3) — the SECOND child; canonical
    // selection follows the alias, not child order (red is led2 here).
    expect(j.constants['pins.aliases.LED']).toBe('GPIO3');
  });
});

describe('hal-parser D/A defers to pinAliasMap', () => {
  it('D0 on a board manifest resolves to the wired pin, not Arduino 0', () => {
    // buildProgramIR resets state (pinAliasMap etc.) on entry, and populates
    // the maps from the @typecad/board import during the import phase. Use
    // the transpile harness (which feeds boardConstants through the real
    // path) with a .cuttlefish/board.json on disk so findGeneratedBoard
    // resolves the virtual specifier.
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    
    

    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-'));
    fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
    fs.mkdirSync(path.join(proj, '.cuttlefish'), { recursive: true });
    const g = generateBoard('xiao_ble/nrf52840');
    fs.writeFileSync(path.join(proj, '.cuttlefish', 'board.ts'), g.boardTs);
    fs.writeFileSync(path.join(proj, '.cuttlefish', 'board.json'), g.boardJson);

    const r = transpile([
      "import { GPIO } from '@typecad/hal';",
      "import { D0 } from '@typecad/board';",
      'const p = new GPIO(D0, GPIO.OUTPUT);',
      'p.set(true);',
      '',
    ].join('\n'), { fileName: path.join(proj, 'src', 'main.ts'), strategy: new ZephyrStrategy() });

    // D0 = gpio0.2: the emitted C++ drives gpio0 with pin 2 (not 0 — the
    // Arduino-style arithmetic would have produced pin 0).
    expect(r.cpp).toMatch(/gpio_pin_configure\(.*gpio0.*,\s*2,/);
    expect(r.cpp).toMatch(/gpio_pin_set_raw\(.*gpio0.*,\s*2,/);
    fs.rmSync(proj, { recursive: true, force: true });
  });
});
