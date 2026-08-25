// MCU-package silicon Zephyr chip data for the STM32F411 — the MCU-only path
// (a config with `mcu:` and no `board:`). The MCU package's `zephyr` field is
// the silicon-level lower layer of the board packages' field: SoC name,
// devicetree includes, GPIO controller split, default console + clock plan.
// resolveChipFromBoard() must accept it WITHOUT any build.frameworks.zephyr
// target (the build target of an MCU-only project is the generated custom
// board's name, carried in frameworkData, not in board constants).
//
// Verified against Zephyr 4.3/4.4:
//   dts/arm/st/f4/stm32f411Xe.dtsi + stm32f411c(c-e)ux-pinctrl.dtsi
//   boards/weact/blackpill_f411ce (the clock plan + console mux the silicon
//   defaults mirror)

import { describe, it, expect } from 'vitest';
import { resolveBoardConstants } from '../../../packages/cuttlefish/src/ir/board-resolver';
import { resolveChipFromBoard } from '../../../packages/framework-zephyr/src/chips/resolve';
import { controllerNodelabelForPin } from '../../../packages/framework-zephyr/src/chips/controllers';

const chip = resolveChipFromBoard(
  resolveBoardConstants('mcus/mcu-stm32f411/src/index.ts'),
);

describe('mcu-stm32f411 silicon → ZephyrChipDescriptor (MCU-only path)', () => {
  it('resolves without a board package (zephyr.socs gates, no build.frameworks target)', () => {
    expect(chip).not.toBeNull();
  });

  it('identifies the chip by its SoC (the board target is the generated custom board)', () => {
    expect(chip!.id).toBe('stm32f411xe');
    expect(chip!.soc).toBe('stm32f411xe');
  });

  it('splits GPIO across the three per-port controllers (same routing as the blackpill board)', () => {
    expect(chip!.gpioControllers).toEqual([
      { nodelabel: 'gpioa', minPin: 0, maxPin: 15 },
      { nodelabel: 'gpiob', minPin: 16, maxPin: 31 },
      { nodelabel: 'gpioc', minPin: 32, maxPin: 47 },
    ]);
    expect(controllerNodelabelForPin(chip!, 5)).toBe('gpioa');   // PA5
    expect(controllerNodelabelForPin(chip!, 22)).toBe('gpiob');  // PB6
    expect(controllerNodelabelForPin(chip!, 45)).toBe('gpioc');  // PC13
  });

  it('carries the custom-board generator inputs (SoC, includes, console, clocks)', () => {
    expect(chip!.customBoard).toBeDefined();
    expect(chip!.customBoard!.socs).toEqual(['stm32f411xe']);
    expect(chip!.customBoard!.dtsIncludes).toEqual([
      'st/f4/stm32f411Xe.dtsi',
      'st/f4/stm32f411c(c-e)ux-pinctrl.dtsi',
    ]);
    expect(chip!.customBoard!.console).toEqual({
      nodeLabel: 'usart1',
      tx: 'usart1_tx_pa9',
      rx: 'usart1_rx_pa10',
      speed: 115200,
    });
    expect(chip!.customBoard!.clocks).toEqual({
      hseMHz: 25,
      pll: { divM: 25, mulN: 192, divP: 2, divQ: 4 },
      sysMHz: 96,
      ahbPrescaler: 1,
      apb1Prescaler: 2,
      apb2Prescaler: 1,
    });
    expect(chip!.customBoard!.usbNode).toBe('usbotg_fs');
  });

  it('keeps the silicon peripheral facts (iwdg watchdog, ADC1 channels, PWM specs)', () => {
    expect(chip!.wdt).toEqual({ nodeLabel: 'iwdg' });
    expect(chip!.adc?.nodeLabel).toBe('adc1');
    expect(chip!.adc?.channels.find((c) => c.pin === 0)?.pinctrl).toBe('adc1_in0_pa0');
    expect(chip!.pwm?.specs.map((s) => s.pin)).toEqual([22, 23]);
    expect(chip!.usb).toEqual({ controller: 'zephyr_udc0', cdcInstances: 1 });
  });

  it('declares only the console UART — STM32 bindings require pinctrl on enabled nodes, and the other instances carry no synthesis data yet', () => {
    expect(chip!.uart?.controllers.map((c) => c.nodeLabel)).toEqual(['usart1']);
    expect(chip!.i2c).toBeUndefined();
    expect(chip!.spi).toBeUndefined();
  });
});

describe('board-resolved chips stay board-shaped', () => {
  it('the blackpill board chip carries no customBoard data (its board already exists)', () => {
    const boardChip = resolveChipFromBoard(
      resolveBoardConstants('boards/board-blackpill-f411ce/src/index.ts'),
    );
    expect(boardChip).not.toBeNull();
    expect(boardChip!.customBoard).toBeUndefined();
    expect(boardChip!.id).toBe('blackpill_f411ce/stm32f411xe');
  });

  it('constants with neither a board target nor zephyr.socs still resolve to null', () => {
    expect(resolveChipFromBoard(new Map())).toBeNull();
    expect(resolveChipFromBoard(new Map([['zephyr.gpioController', 'gpio0']]))).toBeNull();
  });
});
