// ---------------------------------------------------------------------------
// test-chip.ts — a synthetic board descriptor for lowering tests.
//
// There is no curated chip registry anymore: every board's chip view comes
// from its generated manifest via resolveChipFromBoard. This helper builds
// that view the equal way — generateBoard over a real catalog board
// (xiao_ble), then resolveChipFromBoard over the emitted constants — and
// augments it with synthetic silicon fields (ADC channels, PWM matrix, USB
// capability tables) where the tests exercise lowering logic that has no
// devicetree source. Nothing here ships in the product.
// ---------------------------------------------------------------------------

import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import { resolveChipFromBoard } from '../../../../packages/framework-zephyr/src/chips/resolve';
import type { ZephyrChipDescriptor } from '../../../../packages/framework-zephyr/src/chips/types';

function buildTestChip(): ZephyrChipDescriptor {
  const { boardJson } = generateBoard('xiao_ble/nrf52840');
  const manifest = JSON.parse(boardJson) as { constants: Record<string, string | number | boolean> };
  // Synthetic silicon layer (never in devicetree — this is exactly the data
  // the old curated descriptors hand-carried, kept only as test inputs).
  Object.assign(manifest.constants, {
    'zephyr.adc.nodeLabel': 'adc',
    'zephyr.adc.resolution': 12,
    'zephyr.adc.vrefMv': 3000,
    'zephyr.adc.channels.0.pin': 2, 'zephyr.adc.channels.0.channel': 0,
    'zephyr.adc.channels.1.pin': 3, 'zephyr.adc.channels.1.channel': 1,
    'zephyr.adc.channels.2.pin': 4, 'zephyr.adc.channels.2.channel': 2,
    'zephyr.adc.channels.3.pin': 5, 'zephyr.adc.channels.3.channel': 3,
    'zephyr.adc.channels.4.pin': 28, 'zephyr.adc.channels.4.channel': 4,
    'zephyr.adc.channels.5.pin': 29, 'zephyr.adc.channels.5.channel': 5,
    'zephyr.adc.channels.6.pin': 30, 'zephyr.adc.channels.6.channel': 6,
    'zephyr.adc.channels.7.pin': 31, 'zephyr.adc.channels.7.channel': 7,
    // The pwm-led0 spec rides pin 17 in the fixture (the manifest's virtual
    // 8192 form is the board's own; tests address the real pad).
    'zephyr.pwm.specs.0.pin': 17,
    'zephyr.pwm.matrix.controller': 'pwm0',
    'zephyr.pwm.matrix.channelCount': 4,
    'zephyr.pwm.matrix.pins.0': 1,
    'zephyr.pwm.matrix.pins.1': 2,
    'zephyr.pwm.matrix.pins.2': 3,
    'zephyr.pwm.matrix.pins.3': 29,
    'zephyr.pwm.clockHz': 16000000,
    'zephyr.usb.controller': 'zephyr_udc0',
    'zephyr.usb.cdcInstances': 1,
    'zephyr.usb.vid': '0x2341',
    'zephyr.usb.pid': '0x805a',
    'zephyr.dac.device': 'dac0',
    'zephyr.dac.channels.0.pin': 2,
    'zephyr.dac.channels.0.channel': 0,
  });
  const constants = new Map(Object.entries(manifest.constants));
  const chip = resolveChipFromBoard(constants);
  if (!chip) throw new Error('test chip: resolveChipFromBoard returned null for xiao_ble');
  TEST_CHIP_CONSTANTS = constants;
  return {
    ...chip,
    adc: {
      nodeLabel: 'adc',
      resolution: 12,
      vrefMv: 3000,
      channels: [
        { pin: 2, channel: 0 },   // P0.02
        { pin: 3, channel: 1 },   // P0.03
        { pin: 4, channel: 2 },   // P0.04
        { pin: 5, channel: 3 },   // P0.05
        { pin: 28, channel: 4 },  // P0.28
        { pin: 29, channel: 5 },  // P0.29
        { pin: 30, channel: 6 },  // P0.30
        { pin: 31, channel: 7 },  // P0.31
      ],
    },
    pwm: {
      // A pwm-led0 spec on pin 17 (the XIAO blue-LED PWM line the gpio/pwm
      // lowering tests address); matrix from the injected constants.
      specs: [{ pin: 17, controller: 'pwm0', channel: 0, dtSpec: 'pwm_led0' }],
      ...(chip.pwm?.matrix ? { matrix: chip.pwm.matrix } : {}),
      clockHz: 16000000,
    },
    usb: {
      controller: 'zephyr_udc0',
      cdcInstances: 1,
      vid: '0x2341',
      pid: '0x805a',
    },
    dac: chip.dac ?? { device: 'dac0', channels: [{ pin: 2, channel: 0 }] },
    hwtimer: { controllers: [{ nodeLabel: 'rtc1' }] },
  };
}

/** The constants that reconstruct TEST_CHIP — pass as transpile's
 *  boardConstants so the strategy resolves the same chip view. */
export let TEST_CHIP_CONSTANTS: BoardConstants;


/** Shared synthetic board for the lowering/hal-resolution suites. */
export const TEST_CHIP: ZephyrChipDescriptor = buildTestChip();

/** Build the equal-path chip view for any catalog board identifier. */
export function chipForBoard(identifier: string): ZephyrChipDescriptor {
  const { boardJson } = generateBoard(identifier);
  const manifest = JSON.parse(boardJson) as { constants: Record<string, string | number | boolean> };
  const chip = resolveChipFromBoard(new Map(Object.entries(manifest.constants)));
  if (!chip) throw new Error('test chip: resolveChipFromBoard returned null for ' + identifier);
  return chip;
}

/** ESP32-S3 devkit chip view + the synthetic silicon (LEDC matrix, DAC)
 *  the thin-class lowering tests exercise. */
export const ESP32S3_DEVKITC: ZephyrChipDescriptor = {
  ...chipForBoard('esp32s3_devkitc/esp32s3/procpu'),
  pwm: {
    specs: [],
    matrix: { controller: 'ledc0', channelCount: 8, pins: Array.from({ length: 49 }, (_, i) => i).filter((p) => p !== 19) },
    clockHz: 80000000,
  },
  dac: {
    device: 'dac0',
    channels: [{ pin: 25, channel: 1, resolution: 8 }, { pin: 26, channel: 2, resolution: 8 }],
  },
  usb: { controller: 'zephyr_udc0', cdcInstances: 1 },
};

/** ESP32 devkit chip view + synthetic DAC channels (GPIO25/26). */
export const ESP32_DEVKITC: ZephyrChipDescriptor = {
  ...chipForBoard('esp32_devkitc/esp32/procpu'),
  dac: {
    device: 'dac0',
    channels: [{ pin: 25, channel: 1, resolution: 8 }, { pin: 26, channel: 2, resolution: 8 }],
  },
  // The thin-buses UART-ring suite keys the RX ring off a wired uart —
  // the devkit's console uart0 override is the board-level fact.
  uart: { controllers: [{ nodeLabel: 'uart0' }] },
};
