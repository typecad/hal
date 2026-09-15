import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { zephyrDisplayAdapterGenerator } from '../../../../packages/framework-zephyr/src/display/ui-adapter';
import {
  synthesizeZephyrProfile,
  isDtCompatible,
  profileFromEmittedSource,
  panelControllerFor,
} from '../../../../packages/framework-zephyr/src/display/profiles';
import { __setDisplayBindingRootOverride } from '../../../../packages/framework-zephyr/src/display/bindings';
import { generateOverlay } from '../../../../packages/framework-zephyr/src/dt-config/overlay';
import { resolveKconfigFragments } from '../../../../packages/framework-zephyr/src/dt-config/kconfig';
import type { ZephyrChipDescriptor } from '../../../../packages/framework-zephyr/src/chips/types';

const FIXTURES = join(__dirname, '..', '..', '..', 'fixtures', 'display-bindings');

const TEST_CHIP: ZephyrChipDescriptor = {
  id: 'esp32s3', soc: 'esp32s3',
  gpioController: 'gpio0',
  gpio: { dtSpecs: [] },
} as unknown as ZephyrChipDescriptor;

describe('drop-in displays (compatible-driven, no profile)', () => {
  beforeEach(() => __setDisplayBindingRootOverride(FIXTURES));
  afterEach(() => __setDisplayBindingRootOverride(undefined));

  it('recognizes DT compatible strings', () => {
    expect(isDtCompatible('sitronix,st7796s')).toBe(true);
    expect(isDtCompatible('ilitek,ili9341')).toBe(true);
    expect(isDtCompatible('ili9341')).toBe(false);
    expect(isDtCompatible('sdl')).toBe(false);
    expect(isDtCompatible('st7796-zephyr')).toBe(false);
  });

  it('synthesizes a native-transport profile from config facts', () => {
    const p = synthesizeZephyrProfile({
      driver: 'sitronix,st7796s', width: 480, height: 320,
      nativeWidth: 320, nativeHeight: 480, rotation: 1,
    })!;
    expect(p.transport).toBe('zephyr-display');
    expect(p.controller).toBeUndefined();
    expect(panelControllerFor(p)).toBeUndefined();
    // Quirk flags route through.
    const q = synthesizeZephyrProfile({
      driver: 'acme,panel', width: 320, height: 240, channelSwapRb: true, csHold: true,
    })!;
    expect(q.channelSwapRb).toBe(true);
    expect(q.dbiHost).toBe('local-hold-cs');
  });

  it('the adapter generator serves compatible drivers via the synthesized path', () => {
    const code = zephyrDisplayAdapterGenerator({
      driver: 'sitronix,st7796s', width: 480, height: 320,
      nativeWidth: 320, nativeHeight: 480,
    } as never);
    expect(code).toBeTruthy();
    expect(code!.functions).toContain('display_write(__tc_zd_dev');
    // The facts line carries the synthesized profile for the toolchain.
    expect(code!.includes).toMatch(/typecad-display-facts: \{.*"driver":"sitronix,st7796s"/);
    // Non-compatible junk still declines.
    expect(zephyrDisplayAdapterGenerator({ driver: 'nope' } as never)).toBeUndefined();
  });

  it('the toolchain recovers synthesized profiles from the facts line', () => {
    const code = zephyrDisplayAdapterGenerator({
      driver: 'sitronix,st7796s', width: 480, height: 320,
      nativeWidth: 320, nativeHeight: 480, rotation: 1,
    } as never)!;
    const recovered = profileFromEmittedSource(`${code.includes}\nvoid f(){}`);
    expect(recovered?.driver).toBe('sitronix,st7796s');
    expect(recovered?.width).toBe(480);
    expect(recovered?.nativeWidth).toBe(320);
    expect(recovered?.transport).toBe('zephyr-display');
  });

  it('the overlay emits a binding-valid node for an unregistered panel', () => {
    const txt = generateOverlay(
      TEST_CHIP,
      { usesDisplay: true },
      synthesizeZephyrProfile({
        driver: 'ilitek,ili9341', width: 320, height: 240,
      })!,
    );
    expect(txt).toContain('compatible = "ilitek,ili9341"');
    // The fixture's lcd-controller include chain makes pixel-format required.
    expect(txt).toContain('pixel-format = <0>;');
    // The fixture's mipi-dbi include makes mipi-max-frequency required —
    // already emitted by the generator itself.
    expect(txt).toContain('mipi-max-frequency = <80000000>;');
  });

  it('expresses config rotation through madctl on madctl-style panels', () => {
    // The sitronix binding's madctl is OPTIONAL with a neutral portrait
    // default — without emitting it, landscape writes fall outside the
    // portrait address window (the half-scrambled screen on the rig).
    const txt = generateOverlay(
      TEST_CHIP,
      { usesDisplay: true },
      synthesizeZephyrProfile({
        driver: 'sitronix,st7796s', width: 480, height: 320,
        nativeWidth: 320, nativeHeight: 480, rotation: 1,
      })!,
    );
    expect(txt).toContain('madctl = <0x28>;');
    // The fixture's pgc ships its own default — emitted verbatim (the real
    // binding ships none; that path falls back to the rig-validated tuning).
    expect(txt).toContain('pgc = [f0 09 0b 06];');
  });

  it('i2c-family panels get an I2C child node with standard mono props', () => {
    const txt = generateOverlay(
      TEST_CHIP,
      { usesDisplay: true },
      synthesizeZephyrProfile({ driver: 'solomon,ssd1306', width: 128, height: 64 })!,
      { address: 0x3c },
    );
    // I2C child shape — no mipi-dbi bridge, no SPI bus block.
    expect(txt).toContain('&i2c0 {');
    expect(txt).toContain('display0: ssd1306@3c {');
    expect(txt).toContain('compatible = "solomon,ssd1306"');
    expect(txt).toContain('reg = <0x3c>');
    expect(txt).not.toContain('mipi-dbi');
    // The default-free required props get the standard upstream values.
    expect(txt).toContain('multiplex-ratio = <63>');
    expect(txt).toContain('prechargep = <0x22>');
    expect(txt).toContain('segment-offset = <0>');
  });

  it('kconfig assigns no driver symbol for synthesized panels (DT-default-on)', () => {
    const m = resolveKconfigFragments({ usesDisplay: true, displayTransport: 'zephyr-display' }, false);
    expect(m.get('CONFIG_MIPI_DBI_SPI')).toBe('y');
    expect(m.has('CONFIG_ILI9341')).toBe(false);
    expect(m.has('CONFIG_ST7796S')).toBe(false);
  });

  it('kconfig routes i2c-family displays to I2C with no SPI/MIPI block', () => {
    const m = resolveKconfigFragments({ usesDisplay: true, displayBus: 'i2c' }, false);
    expect(m.get('CONFIG_I2C')).toBe('y');
    expect(m.has('CONFIG_SPI')).toBe(false);
    expect(m.has('CONFIG_MIPI_DBI')).toBe(false);
    expect(m.has('CONFIG_DMA')).toBe(false);
  });
});
