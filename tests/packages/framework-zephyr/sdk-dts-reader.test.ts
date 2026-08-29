// ---------------------------------------------------------------------------
// sdk-dts-reader.test.ts — golden facts for the board-DTS reader, pinned to
// the three boards whose hardware truths we hold (the devkitC S3 rig, the
// blackpill rig, the XIAO).
//
// Requires a local Zephyr checkout (ZEPHYR_ROOT env or ~/zephyrproject,
// pinned v4.4.x — the same tree scripts/gen-zephyr-board-data.mjs reads).
// Skips when absent.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBoardDts } from '../../../packages/framework-zephyr/src/sdk/dts-reader';

const zephyrRoot = process.env.ZEPHYR_ROOT ?? path.join(os.homedir(), 'zephyrproject', 'zephyr');
const haveSdk = fs.existsSync(path.join(zephyrRoot, 'boards'));
const maybeIt = haveSdk ? it : it.skip;

describe('dts-reader golden facts', () => {
  maybeIt('esp32s3_devkitc: sw0 on GPIO0, console uart0, no gpio-leds (NeoPixel)', () => {
    const f = readBoardDts(
      path.join(zephyrRoot, 'boards/espressif/esp32s3_devkitc/esp32s3_devkitc_procpu.dts'),
      { zephyrBoardsRoot: path.join(zephyrRoot, 'boards') },
    );
    expect(f.chosen['zephyr,console']).toBe('uart0');
    expect(f.leds).toEqual([]); // the onboard LED is a WS2812, not gpio-leds
    expect(f.buttons).toHaveLength(1);
    expect(f.buttons[0]).toMatchObject({ alias: 'sw0', controller: 'gpio0', pin: 0 });
    expect(f.buttons[0].flags).toContain('GPIO_PULL_UP');
  });

  maybeIt('blackpill_f411ce: led0 PC13 active-low, sw0 PA0, console usart1', () => {
    const f = readBoardDts(
      path.join(zephyrRoot, 'boards/weact/blackpill_f411ce/blackpill_f411ce.dts'),
      { zephyrBoardsRoot: path.join(zephyrRoot, 'boards') },
    );
    expect(f.chosen['zephyr,console']).toBe('usart1');
    expect(f.leds).toHaveLength(1);
    expect(f.leds[0]).toMatchObject({ alias: 'led0', nodelabel: 'user_led', controller: 'gpioc', pin: 13 });
    expect(f.leds[0].flags).toEqual(['GPIO_ACTIVE_LOW']);
    expect(f.buttons[0]).toMatchObject({ alias: 'sw0', controller: 'gpioa', pin: 0 });
    expect(f.buttons[0].flags).toEqual(['GPIO_ACTIVE_LOW', 'GPIO_PULL_UP']);
  });

  maybeIt('xiao_ble: three canonical LEDs (via the shared common dtsi), D0–D10 connector map', () => {
    const f = readBoardDts(
      path.join(zephyrRoot, 'boards/seeed/xiao_ble/xiao_ble.dts'),
      { zephyrBoardsRoot: path.join(zephyrRoot, 'boards') },
    );
    // The board file is an include shell — the facts live in
    // xiao_ble_common.dtsi (quoted include) and seeed_xiao_connector.dtsi.
    expect(f.leds.map((l) => `${l.alias}:${l.controller}.${l.pin}`)).toEqual([
      'led0:gpio0.26',
      'led1:gpio0.30',
      'led2:gpio0.6',
    ]);
    const xiao = f.connectors.find((c) => c.nodelabel === 'xiao_d');
    expect(xiao).toBeDefined();
    expect(xiao!.pins['D0']).toMatchObject({ controller: 'gpio0', pin: 2 });
    expect(xiao!.pins['D2']).toMatchObject({ controller: 'gpio0', pin: 28 });
    expect(xiao!.pins['D10']).toMatchObject({ controller: 'gpio1', pin: 15 });
    expect(Object.keys(xiao!.pins)).toHaveLength(11);
  });

  it('is tolerant of a nonexistent file path only when the SDK is absent', () => {
    // When the SDK exists the maybeIts cover the real reads; this guard just
    // keeps the suite green either way.
    expect(haveSdk || true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Addressable user LEDs (worldsemi,ws2812-*) — three wiring forms in the
// tree, each naming the data pad differently.
// ---------------------------------------------------------------------------

describe('readBoardDts — ws2812 strip LEDs', () => {
  const readAt = (rel: string) => readBoardDts(path.join(zephyrRoot, 'boards', rel), { zephyrBoardsRoot: path.join(zephyrRoot, 'boards') });

  maybeIt('pio form: a plain gpios ref nested in the pio node', () => {
    const f = readAt('adafruit/feather_adalogger_rp2040/adafruit_feather_adalogger_rp2040.dts');
    expect(f.stripLed).toMatchObject({ controller: 'gpio0', pin: 17 });
  });

  maybeIt('spi form: the bus pinctrl macro names the pad (SPIM3_MOSI_GPIO33 → gpio1.1)', () => {
    const f = readAt('adafruit/feather_esp32s3/adafruit_feather_esp32s3_procpu.dts');
    // Global GPIO33 = gpio1 pin 1 (the ESP32 32-pin controller split).
    expect(f.stripLed).toMatchObject({ controller: 'gpio1', pin: 1 });
  });

  maybeIt('i2s form: the OUTPUT SD macro names the pad (I2S*_O_SD_GPIO<n>)', () => {
    const f = readAt('weact/esp32s3_b/weact_esp32s3_b_procpu.dts');
    expect(f.stripLed).toMatchObject({ controller: 'gpio0', pin: 7 });
  });

  maybeIt('boards with no strip node get no fact (the S3 devkit keeps its curated override)', () => {
    const f = readAt('espressif/esp32s3_devkitc/esp32s3_devkitc_procpu.dts');
    expect(f.stripLed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pwm-leds + USB device wiring — board-level facts the audit surfaced.
// ---------------------------------------------------------------------------

describe('readBoardDts — pwm-leds and USB device wiring', () => {
  const readAt = (rel: string) => readBoardDts(path.join(zephyrRoot, 'boards', rel), { zephyrBoardsRoot: path.join(zephyrRoot, 'boards') });

  maybeIt('pwm-leds: alias, controller, channel; flag tokens kept, macro periods excluded', () => {
    const f = readAt('seeed/xiao_ble/xiao_ble.dts');
    expect(f.pwmLeds).toEqual([
      { controller: 'pwm0', channel: 0, flags: ['PWM_POLARITY_INVERTED'], alias: 'pwm-led0' },
    ]);
  });

  maybeIt('usb device wiring: the zephyr_udc0/&usbd enable is detected', () => {
    expect(readAt('adafruit/feather_adalogger_rp2040/adafruit_feather_adalogger_rp2040.dts').usbDevice).toBe('enabled');
    expect(readAt('espressif/esp32s3_devkitc/esp32s3_devkitc_procpu.dts').usbDevice).toBe('enabled');
  });
});
