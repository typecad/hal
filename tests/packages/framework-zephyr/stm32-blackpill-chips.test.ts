// Board-package Zephyr chip data for the WeAct Black Pill V2.0
// (STM32F411CEU6) — the resolveChipFromBoard() path, and the first STM32
// target. This board ships its ZephyrChipDescriptor via the board package's
// `zephyr` field (flattened into board constants), NOT via
// framework-zephyr's hardcoded chip registry, so this test exercises the
// real flattener against the real board sources.
//
// Descriptor facts verified against Zephyr 4.3 (4.3.99):
//   boards/weact/blackpill_f411ce/blackpill_f411ce.dts
//     (led0 = PC13 active-low, sw0 = PA0 active-low + pull-up,
//      usart1/i2c1/spi1 status okay, pwm4 enabled with NO DT alias)
//   dts/arm/st/f4/stm32f411.dtsi → stm32f401.dtsi → stm32f4.dtsi
//     (gpioa/gpiob/gpioc per-port controllers, iwdg watchdog, adc1)
//   Pin numbering: port blocks — PA<bit> → bit, PB<bit> → 16+bit,
//   PC<bit> → 32+bit (PC13 → 45), matching @typecad/mcu-stm32f411.

import { describe, it, expect } from 'vitest';
import { resolveBoardConstants } from '../../../packages/cuttlefish/src/ir/board-resolver';
import { resolveChipFromBoard } from '../../../packages/framework-zephyr/src/chips/resolve';
import { controllerNodelabelForPin, controllerRawPinForPin } from '../../../packages/framework-zephyr/src/chips/controllers';

const chip = resolveChipFromBoard(
  resolveBoardConstants('boards/board-blackpill-f411ce/src/index.ts'),
);

describe('board-blackpill-f411ce → ZephyrChipDescriptor', () => {
  it('resolves (the board package carries a zephyr build target + chip data)', () => {
    expect(chip).not.toBeNull();
  });

  it("targets the qualified 'blackpill_f411ce/stm32f411xe' for west build -b", () => {
    expect(chip!.id).toBe('blackpill_f411ce/stm32f411xe');
  });

  it('splits GPIO across three per-port controllers (gpioa/gpiob/gpioc)', () => {
    expect(chip!.gpioController).toBe('gpioa');
    expect(chip!.gpioControllers).toEqual([
      { nodelabel: 'gpioa', minPin: 0, maxPin: 15 },
      { nodelabel: 'gpiob', minPin: 16, maxPin: 31 },
      { nodelabel: 'gpioc', minPin: 32, maxPin: 47 },
    ]);
  });

  it('routes HAL pins to their owning port controller (PA5→gpioa, PB8→gpiob, PC13→gpioc)', () => {
    expect(controllerNodelabelForPin(chip!, 5)).toBe('gpioa');   // PA5
    expect(controllerNodelabelForPin(chip!, 22)).toBe('gpiob');  // PB6
    expect(controllerNodelabelForPin(chip!, 24)).toBe('gpiob');  // PB8
    expect(controllerNodelabelForPin(chip!, 45)).toBe('gpioc');  // PC13
    expect(controllerNodelabelForPin(chip!, 47)).toBe('gpioc');  // PC15
  });

  it('derives PORT-RELATIVE raw indices (gpio_pin_*_raw addresses the index within the controller)', () => {
    // The port-block numbering rule: raw = pin - minPin. PB12 = 28 - 16 = 12 —
    // a global number against gpiob (0-15) would address a nonexistent bit.
    expect(controllerRawPinForPin(chip!, 5)).toBe(5);    // PA5  → gpioa 5
    expect(controllerRawPinForPin(chip!, 22)).toBe(6);   // PB6  → gpiob 6
    expect(controllerRawPinForPin(chip!, 28)).toBe(12);  // PB12 → gpiob 12
    expect(controllerRawPinForPin(chip!, 31)).toBe(15);  // PB15 → gpiob 15
    expect(controllerRawPinForPin(chip!, 45)).toBe(13);  // PC13 → gpioc 13
  });

  it('numbers PB12–PB15 by port blocks (28–31), never contiguously past the unbonded PB11', () => {
    const bc = resolveBoardConstants('boards/board-blackpill-f411ce/src/index.ts');
    const byNumber = new Map<number, string>();
    for (let i = 0; i < 48; i++) {
      const nm = bc.get(`pins.all.${i}.name`);
      const num = bc.get(`pins.all.${i}.number`);
      if (nm !== undefined && num !== undefined) byNumber.set(Number(num), String(nm));
    }
    expect(byNumber.get(28)).toBe('PB12');
    expect(byNumber.get(31)).toBe('PB15');
    expect(byNumber.has(27)).toBe(false); // PB11 is not bonded — no pin owns 27
  });

  it('exposes the onboard LED (PC13 → pin 45) and KEY button (PA0 → pin 0) via DT aliases', () => {
    expect(chip!.gpio.dtSpecs).toContainEqual({ pin: 45, dtSpec: 'led0' });
    expect(chip!.gpio.dtSpecs).toContainEqual({ pin: 0, dtSpec: 'sw0' });
  });

  it('declares the KEY button (sw0) as the interrupt pin', () => {
    expect(chip!.gpio.interruptPins).toEqual([{ pin: 0, dtSpec: 'sw0' }]);
  });

  it('wires i2c1 / spi1 / usart1 (the board default-enabled controllers)', () => {
    expect(chip!.i2c?.controllers).toEqual([{ nodeLabel: 'i2c1' }]);
    expect(chip!.spi?.controllers).toEqual([{ nodeLabel: 'spi1' }]);
    expect(chip!.uart?.controllers).toEqual([{ nodeLabel: 'usart1' }]);
  });

  it("declares the STM32 independent watchdog node 'iwdg' (NOT the wdt0 default)", () => {
    expect(chip!.wdt).toEqual({ nodeLabel: 'iwdg' });
  });

  it('declares synthesized PWM specs on pwm4 ch1/ch2 (PB6/PB7) — no board-shipped DT alias', () => {
    expect(chip!.pwm?.specs).toEqual([
      { pin: 22, controller: 'pwm4', channel: 1, periodNs: 20_000_000 },
      { pin: 23, controller: 'pwm4', channel: 2, periodNs: 20_000_000 },
    ]);
  });

  it('declares the ADC1 map with the STM32 driver-required gain/reference + pinctrl labels', () => {
    expect(chip!.adc!.nodeLabel).toBe('adc1');
    expect(chip!.adc!.resolution).toBe(12);
    expect(chip!.adc!.vrefMv).toBe(3300);
    expect(chip!.adc!.gain).toBe('ADC_GAIN_1');
    expect(chip!.adc!.reference).toBe('ADC_REF_INTERNAL');
    expect(chip!.adc!.channels).toEqual([
      { pin: 0, channel: 0, pinctrl: 'adc1_in0_pa0' },
      { pin: 1, channel: 1, pinctrl: 'adc1_in1_pa1' },
      { pin: 2, channel: 2, pinctrl: 'adc1_in2_pa2' },
      { pin: 3, channel: 3, pinctrl: 'adc1_in3_pa3' },
      { pin: 4, channel: 4, pinctrl: 'adc1_in4_pa4' },
      { pin: 5, channel: 5, pinctrl: 'adc1_in5_pa5' },
      { pin: 6, channel: 6, pinctrl: 'adc1_in6_pa6' },
      { pin: 7, channel: 7, pinctrl: 'adc1_in7_pa7' },
      { pin: 16, channel: 8, pinctrl: 'adc1_in8_pb0' },
      { pin: 17, channel: 9, pinctrl: 'adc1_in9_pb1' },
    ]);
  });

  it('declares no radio (omitted — radioless target)', () => {
    expect(chip!.wifi).toBeUndefined();
  });
});
