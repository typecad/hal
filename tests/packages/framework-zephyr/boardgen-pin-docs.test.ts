// ---------------------------------------------------------------------------
// boardgen-pin-docs.test.ts — the JSDoc editor annotations on the generated
// board module's pin exports. buildModule is a pure function over a board
// record, so a hand-built entry exercises every annotation source without
// the catalog: silicon PWM/ADC routes, the any-pad PWM matrix, bus roles,
// and LED/BUTTON/connector aliases. Bare pins must stay bare — the doc's
// absence IS the "plain GPIO" signal (the module header documents it).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { buildModule } from '../../../packages/framework-zephyr/src/boardgen';
import type { BoardDataEntry } from '../../../packages/cuttlefish/src/board-catalog/types';

// STM32-style letter-port record: tim4 PWM on PB6, adc1 ch1 on PA1, i2c1 on
// PB7/PB8, LED on PC13, BUTTON on PA0, connector label D0 on PB6.
const letterPort: BoardDataEntry = {
  identifier: 'testpill/stm32f411xe',
  name: 'Test Pill',
  vendor: 'typecad',
  dts: '',
  led: { dtSpec: 'led0', controller: 'gpioc', pin: 13, flags: [] },
  button: { dtSpec: 'sw0', controller: 'gpioa', pin: 0, flags: [] },
  buses: { i2c: ['i2c1'], spi: [], uart: ['usart1'] },
  busPins: [
    {
      bus: 'i2c',
      nodelabel: 'i2c1',
      routes: [
        { name: 'i2c1_sda_pb7', role: 'SDA', pad: 'PB7' },
        { name: 'i2c1_scl_pb8', role: 'SCL', pad: 'PB8' },
      ],
    },
  ],
  pwmPins: [{ source: 'tim4', channel: 1, port: 'B', bit: 6, pinctrl: 'tim4_ch1_pb6' }],
  adcPins: [{ source: 'adc1', channel: 1, port: 'A', bit: 1, pinctrl: 'adc1_in1_pa1' }],
  analogDevices: ['adc1'],
  connectors: [
    { nodelabel: 'hdr', compatible: 'typecad,test-hdr', pins: { D0: { controller: 'gpiob', pin: 6, flags: [] } } },
  ],
};

// ESP32-style record: LEDC any-pad matrix + SARADC routes on two pads.
const matrixBoard: BoardDataEntry = {
  identifier: 'testkit/esp32s3',
  name: 'Test Kit',
  vendor: 'typecad',
  dts: '',
  pwmMatrix: { controller: 'ledc0', channelCount: 8, pads: [1, 2] },
  espAdc: [{ source: 'adc0', pad: 1, channel: 0 }],
  analogDevices: ['adc0'],
};

describe('boardgen pin JSDoc annotations', () => {
  it('stamps silicon routes, bus roles, and aliases on the pin exports', () => {
    const { boardTs } = buildModule(letterPort);

    // PWM route: tim{N} → pwm{N}, on the pad's datasheet pin; the connector
    // label that points at the same pad rides the aliases tail.
    expect(boardTs).toMatch(/\/\*\* PWM pwm4 ch1 · aliases: D0 \*\/\nexport const PB6 = Pin\.fromPort\('PB6'\);/);
    // ADC route: controller + channel from the pinctrl harvest.
    expect(boardTs).toMatch(/\/\*\* ADC adc1 ch1 \*\/\nexport const PA1 = Pin\.fromPort\('PA1'\);/);
    // Bus roles join by the route's pad name.
    expect(boardTs).toMatch(/\/\*\* I2C0 SDA \*\/\nexport const PB7 = Pin\.fromPort\('PB7'\);/);
    expect(boardTs).toMatch(/\/\*\* I2C0 SCL \*\/\nexport const PB8 = Pin\.fromPort\('PB8'\);/);
    // LED/BUTTON aliases land on the aliased pin's own export.
    expect(boardTs).toMatch(/\/\*\* aliases: LED \*\/\nexport const PC13 = Pin\.fromPort\('PC13'\);/);
    expect(boardTs).toMatch(/\/\*\* aliases: BUTTON \*\/\nexport const PA0 = Pin\.fromPort\('PA0'\);/);

    // Pins with no fact stay bare — no doc line, the documented convention.
    expect(boardTs).toMatch(/\nexport const PA2 = Pin\.fromPort\('PA2'\);/);
    expect(boardTs).not.toMatch(/\/\*\*[^\n]*\*\/\nexport const PA2 = Pin\.fromPort\('PA2'\);/);
    expect(boardTs).not.toContain('GPIO only');

    // Bus instances carry their pad routes when harvested — the hover fact
    // for I2C0/UART0/USB0.
    expect(boardTs).toMatch(
      /\/\*\* Board-wired I2C bus 0 \(SDA=PB7, SCL=PB8\)\. \*\/\nexport const I2C0 = new I2CBus\('I2C0'\);/,
    );
    // A controller with no harvested pad routes keeps the bare form.
    expect(boardTs).toMatch(
      /\/\*\* Board-wired UART 0\. \*\/\nexport const UART0 = new UART\('UART0'\);/,
    );
  });

  it('marks any-pad PWM matrix membership and matrix-family ADC routes', () => {
    const { boardTs } = buildModule(matrixBoard);

    expect(boardTs).toMatch(
      /\/\*\* PWM ledc0 ch0-7 \(any pad\) · ADC adc0 ch0 \*\/\nexport const GPIO1 = Pin\.fromPort\('GPIO1'\);/,
    );
    expect(boardTs).toMatch(
      /\/\*\* PWM ledc0 ch0-7 \(any pad\) \*\/\nexport const GPIO2 = Pin\.fromPort\('GPIO2'\);/,
    );
    // A pad outside the matrix carries no PWM claim.
    expect(boardTs).toMatch(/\nexport const GPIO3 = Pin\.fromPort\('GPIO3'\);/);
    expect(boardTs).not.toMatch(/\/\*\*[^\n]*\*\/\nexport const GPIO3 = Pin\.fromPort\('GPIO3'\);/);
  });
});
