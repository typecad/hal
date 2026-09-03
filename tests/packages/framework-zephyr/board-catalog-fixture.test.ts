// ---------------------------------------------------------------------------
// board-catalog-fixture.test.ts — pins the checked-in fixture overlay (the
// catalog the test suites resolve against) on the boards whose hardware
// truths we hold, plus overlay-level invariants. Regenerate the fixture
// from a real tree when the referenced board set changes; never hand-edit.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readBoardCatalogOverlayFile } from '../../../packages/cuttlefish/src/board-catalog/store';

const overlay = readBoardCatalogOverlayFile(
  fileURLToPath(new URL('../../fixtures/board-catalog.overlay.json', import.meta.url)),
)!;
const CATALOG = overlay.data;

describe('board catalog fixture', () => {
  it('is keyed by qualified targets and non-empty', () => {
    const keys = Object.keys(CATALOG);
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) {
      expect(CATALOG[k].identifier).toBe(k);
      expect(k.includes('/')).toBe(true);
    }
  });

  it('esp32s3_devkitc/esp32s3/procpu: sw0 on GPIO0, console uart0, no LED', () => {
    const b = CATALOG['esp32s3_devkitc/esp32s3/procpu'];
    expect(b).toBeDefined();
    expect(b.console).toBe('uart0');
    expect(b.led).toBeUndefined(); // WS2812, not gpio-leds
    expect(b.button).toMatchObject({ dtSpec: 'sw0', controller: 'gpio0', pin: 0 });
  });

  it('blackpill_f411ce/stm32f411xe: led0 PC13 active-low, sw0 PA0', () => {
    const b = CATALOG['blackpill_f411ce/stm32f411xe'];
    expect(b).toBeDefined();
    expect(b.led).toMatchObject({ dtSpec: 'led0', controller: 'gpioc', pin: 13, flags: ['GPIO_ACTIVE_LOW'] });
    expect(b.button).toMatchObject({ dtSpec: 'sw0', controller: 'gpioa', pin: 0 });
  });

  it('carries bus/usb/watchdog facts where the board DTS declares them', () => {
    const nucleo = CATALOG['nucleo_h753zi/stm32h753xx'];
    expect(nucleo?.buses?.uart?.length).toBeGreaterThan(0);
    const s3 = CATALOG['esp32s3_devkitc/esp32s3/procpu'];
    expect(s3?.usbDevice).toBe('enabled');
  });
});
