// Custom-board generation — the out-of-tree Zephyr board emitted for MCU-only
// targets. The file set is load-bearing (verified by building a hand-written
// minimal board against Zephyr 4.3/4.4, then against the generator output):
//   board.yml + <name>.dts alone fail with "ARCH not defined" — the Kconfig
//   BOARD_<NAME> symbol must select SOC_<SOC>; and without CONFIG_GPIO=y the
//   STM32 pinctrl driver's gpio_ports table references devices that are never
//   built (undefined __device_dts_ord at link time).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateCustomBoard, sanitizeBoardName } from '../../../../packages/framework-zephyr/src/dt-config/custom-board';
import type { ZephyrChipDescriptor } from '../../../../packages/framework-zephyr/src/chips/types';

/** A descriptor shaped like the resolved mcu-stm32f411 silicon (trimmed). */
const stm32f411Chip: ZephyrChipDescriptor = {
  id: 'stm32f411xe',
  soc: 'stm32f411xe',
  gpioController: 'gpioa',
  gpioControllers: [
    { nodelabel: 'gpioa', minPin: 0, maxPin: 15 },
    { nodelabel: 'gpiob', minPin: 16, maxPin: 31 },
    { nodelabel: 'gpioc', minPin: 32, maxPin: 47 },
  ],
  gpio: { dtSpecs: [] },
  usb: { controller: 'zephyr_udc0', cdcInstances: 1 },
  customBoard: {
    socs: ['stm32f411xe'],
    dtsIncludes: [
      'st/f4/stm32f411Xe.dtsi',
      'st/f4/stm32f411c(c-e)ux-pinctrl.dtsi',
    ],
    console: {
      nodeLabel: 'usart1',
      tx: 'usart1_tx_pa9',
      rx: 'usart1_rx_pa10',
      speed: 115200,
    },
    clocks: {
      hseMHz: 25,
      pll: { divM: 25, mulN: 192, divP: 2, divQ: 4 },
      sysMHz: 96,
      ahbPrescaler: 1,
      apb1Prescaler: 2,
      apb2Prescaler: 1,
    },
    usbNode: 'usbotg_fs',
  },
};

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cf-custom-board-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('sanitizeBoardName', () => {
  it('lowercases and collapses illegal characters to underscores', () => {
    expect(sanitizeBoardName('My Project!')).toBe('my_project');
    expect(sanitizeBoardName('pro-mini.v2')).toBe('pro_mini_v2');
  });

  it('trims leading/trailing underscores and never returns empty', () => {
    expect(sanitizeBoardName('--x--')).toBe('x');
    expect(sanitizeBoardName('!!!')).toBe('custom_board');
  });
});

describe('generateCustomBoard', () => {
  it('emits the four load-bearing files under boards/typecad/<name>/', () => {
    const result = generateCustomBoard(tmp, stm32f411Chip, 'My F411!');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my_f411');
    const dir = result!.dir;
    expect(existsSync(join(dir, 'board.yml'))).toBe(true);
    expect(existsSync(join(dir, 'my_f411.dts'))).toBe(true);
    expect(existsSync(join(dir, 'Kconfig.my_f411'))).toBe(true);
    expect(existsSync(join(dir, 'my_f411_defconfig'))).toBe(true);
  });

  it('board.yml declares the SoC from the silicon data', () => {
    const { dir } = generateCustomBoard(tmp, stm32f411Chip, 'my_f411')!;
    const yml = readFileSync(join(dir, 'board.yml'), 'utf8');
    expect(yml).toContain('name: my_f411');
    expect(yml).toContain('vendor: typecad');
    expect(yml).toContain('- name: stm32f411xe');
  });

  it('Kconfig.<name> selects the SoC (without it the build dies with ARCH not defined)', () => {
    const { dir } = generateCustomBoard(tmp, stm32f411Chip, 'my_f411')!;
    const kconfig = readFileSync(join(dir, 'Kconfig.my_f411'), 'utf8');
    expect(kconfig).toContain('config BOARD_MY_F411');
    expect(kconfig).toContain('select SOC_STM32F411XE');
  });

  it('the DTS carries includes, chosen console, the console pinctrl, and the clock plan', () => {
    const { dir } = generateCustomBoard(tmp, stm32f411Chip, 'my_f411')!;
    const dts = readFileSync(join(dir, 'my_f411.dts'), 'utf8');
    expect(dts).toContain('#include <st/f4/stm32f411Xe.dtsi>');
    expect(dts).toContain('#include <st/f4/stm32f411c(c-e)ux-pinctrl.dtsi>');
    expect(dts).toContain('zephyr,console = &usart1;');
    expect(dts).toContain('zephyr,flash = &flash0;');
    expect(dts).toContain('pinctrl-0 = <&usart1_tx_pa9 &usart1_rx_pa10>;');
    expect(dts).toContain('current-speed = <115200>;');
    expect(dts).toContain('clock-frequency = <DT_FREQ_M(25)>;');
    expect(dts).toContain('mul-n = <192>;');
    expect(dts).toContain('clock-frequency = <DT_FREQ_M(96)>;');
    expect(dts).toContain('apb1-prescaler = <2>;');
  });

  it('aliases the silicon USB node under the Zephyr convention, left disabled for the overlay', () => {
    const { dir } = generateCustomBoard(tmp, stm32f411Chip, 'my_f411')!;
    const dts = readFileSync(join(dir, 'my_f411.dts'), 'utf8');
    expect(dts).toContain('zephyr_udc0: &usbotg_fs {');
  });

  it('defconfig carries CONFIG_GPIO (the pinctrl driver link dependency)', () => {
    const { dir } = generateCustomBoard(tmp, stm32f411Chip, 'my_f411')!;
    const defconfig = readFileSync(join(dir, 'my_f411_defconfig'), 'utf8');
    expect(defconfig).toContain('CONFIG_GPIO=y');
    expect(defconfig).toContain('CONFIG_UART_CONSOLE=y');
  });

  it('is idempotent — a second run changes nothing', () => {
    const first = generateCustomBoard(tmp, stm32f411Chip, 'my_f411')!;
    expect(first.changed).toBe(true);
    const second = generateCustomBoard(tmp, stm32f411Chip, 'my_f411')!;
    expect(second.changed).toBe(false);
  });

  it('returns null when the chip has no customBoard (board-resolved) data', () => {
    const boardChip: ZephyrChipDescriptor = { ...stm32f411Chip, customBoard: undefined };
    expect(generateCustomBoard(tmp, boardChip, 'x')).toBeNull();
  });
});
