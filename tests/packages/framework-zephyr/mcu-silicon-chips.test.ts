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
import { SOC_CHIPS } from '../../../packages/framework-zephyr/src/chips/soc/index';
import { resolveChipFromBoard } from '../../../packages/framework-zephyr/src/chips/resolve';
import { controllerNodelabelForPin } from '../../../packages/framework-zephyr/src/chips/controllers';
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../packages/cuttlefish/src/api/shared/board-resolver';
function generatedConstants(target: string): BoardConstants {
  const g = generateBoard(target);
  return new Map(Object.entries(JSON.parse(g.boardJson).constants)) as BoardConstants;
}


const chip = SOC_CHIPS['stm32f411xe'];

describe('stm32f411xe silicon → ZephyrChipDescriptor (soc registry)', () => {
  it('resolves from the soc-keyed registry', () => {
    expect(chip).toBeDefined();
  });

  it('identifies the chip by its SoC', () => {
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
    // The st,stm32f4-adc binding requires these on an enabled node — the
    // generated board pre-enables adc1 with them.
    expect(chip!.customBoard!.adcNode).toEqual({
      nodeLabel: 'adc1',
      clockSource: 'SYNC',
      prescaler: 2,
      pinctrl: 'adc1_in1_pa1',
    });
  });

  it('keeps the silicon peripheral facts (iwdg watchdog, ADC1 channels, PWM specs)', () => {
    expect(chip!.wdt).toEqual({ nodeLabel: 'iwdg' });
    expect(chip!.adc?.nodeLabel).toBe('adc1');
    expect(chip!.adc?.channels.find((c) => c.pin === 0)?.pinctrl).toBe('adc1_in0_pa0');
    expect(chip!.pwm?.specs.map((s) => s.pin)).toEqual([22, 23]);
    // PWM pinctrl tokens — the generated board declares the pwm4 label with
    // them (the st,stm32-pwm binding requires pinctrl-0, and the SoC dtsi
    // ships the timers' pwm child unlabeled).
    expect(chip!.pwm?.specs.map((s) => s.pinctrl)).toEqual(['tim4_ch1_pb6', 'tim4_ch2_pb7']);
    expect(chip!.usb).toMatchObject({ controller: 'zephyr_udc0', cdcInstances: 1 });
  });

  it('carries the USB pinctrl tokens and the default storage partition (custom-board needs)', () => {
    // st,stm32-otgfs requires pinctrl-0 on an enabled node — the generated
    // board pre-enables zephyr_udc0 with exactly these.
    expect(chip!.customBoard!.usbPinctrl).toEqual(['usb_otg_fs_dm_pa11', 'usb_otg_fs_dp_pa12']);
    // Preferences/FS: a generated board has no partitions node, so the
    // usage-driven overlay synthesizes this region under &flash0.
    expect(chip!.storage).toEqual({ offset: 0x00040000, size: 0x00040000 });
  });

  it('declares only the console UART — STM32 bindings require pinctrl on enabled nodes, and the other instances carry no synthesis data yet', () => {
    expect(chip!.uart?.controllers.map((c) => c.nodeLabel)).toEqual(['usart1']);
    // The consolidated soc descriptor merged the reference board's wired
    // controllers — i2c1/spi1 ride along.
    expect(chip!.i2c?.controllers.map((c) => c.nodeLabel)).toEqual(['i2c1']);
    expect(chip!.spi?.controllers.map((c) => c.nodeLabel)).toEqual(['spi1']);
  });
});

describe('board-resolved chips stay board-shaped', () => {
  it('the blackpill soc entry keys the qualified board target (its board already exists)', () => {
    const boardChip = SOC_CHIPS['stm32f411xe'];
    expect(boardChip).toBeDefined();
    expect(boardChip!.id).toBe('blackpill_f411ce/stm32f411xe');
  });

  it('constants with neither a board target nor zephyr.socs still resolve to null', () => {
    expect(resolveChipFromBoard(new Map())).toBeNull();
    expect(resolveChipFromBoard(new Map([['zephyr.gpioController', 'gpio0']]))).toBeNull();
  });
});
