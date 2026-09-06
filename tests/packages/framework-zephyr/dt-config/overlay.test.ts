import { describe, it, expect } from 'vitest';
import { TEST_CHIP, chipForBoard } from '../helpers/test-chip';
import { generateOverlay } from '../../../../packages/framework-zephyr/src/dt-config/overlay';
import { resolveChipFromBoard } from '../../../../packages/framework-zephyr/src/chips/resolve';

// The Black Pill chip view resolves the equal way (from its generated
// manifest). Silicon facts that never live in devicetree — the PWM matrix
// and pinctrl-labeled ADC channels — are synthetic test inputs here, kept
// only so the overlay generator's silicon paths stay exercised.
const BLACKPILL = {
  ...chipForBoard('blackpill_f411ce/stm32f411xe'),
  pwm: {
    specs: [
      { pin: 22, controller: 'pwm4', channel: 1, periodNs: 20_000_000 },
      { pin: 23, controller: 'pwm4', channel: 2, periodNs: 20_000_000 },
    ],
    clockHz: 96_000_000,
  },
  adc: {
    nodeLabel: 'adc1',
    channels: [
      { pin: 0, channel: 0, pinctrl: 'adc1_in0_pa0' },
      { pin: 16, channel: 8, pinctrl: 'adc1_in8_pb0' },
    ],
  },
  wdt: { nodeLabel: 'iwdg' },
  storage: { offset: 0x40000, size: 0x40000 },
};
import { DEFAULT_ZEPHYR_DISPLAY_PROFILE, ZEPHYR_DISPLAY_PROFILES } from '../../../../packages/framework-zephyr/src/display/profiles';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';
function generatedConstants(target: string): BoardConstants {
  const g = generateBoard(target);
  return new Map(Object.entries(JSON.parse(g.boardJson).constants)) as BoardConstants;
}


describe('generateOverlay', () => {
  it('enables used peripherals with status okay', () => {
    const txt = generateOverlay(TEST_CHIP, { usesI2c: true, usesSpi: true }, undefined);
    expect(txt).toContain('&i2c1');
    expect(txt).toContain('&spi2');
    expect(txt).toContain('status = "okay"');
  });

  it('enables the display node when a profile is passed', () => {
    // The display node is emitted as a full / { mipi-dbi { display0: display@0 } }
    // definition (boards have no display node to enable with &display0), so assert
    // on the label + compatible rather than a &display0 reference.
    const txt = generateOverlay(TEST_CHIP, { usesDisplay: true }, DEFAULT_ZEPHYR_DISPLAY_PROFILE);
    expect(txt).toContain('display0: display@0');
    // The default profile is the ILI9341 — the compatible must follow the
    // profile's controller, not a hardcoded panel family.
    expect(txt).toContain('compatible = "ilitek,ili9341"');
    expect(txt).not.toContain('sitronix,st7796s');
    expect(txt).not.toContain('madctl');
  });

  it('emits te-gpios on the display node only when tearingEffectPin is wired', () => {
    const withTe = generateOverlay(TEST_CHIP, { usesDisplay: true }, DEFAULT_ZEPHYR_DISPLAY_PROFILE, { tearingEffectPin: 21 });
    expect(withTe).toContain('te-gpios = <&gpio0 21 GPIO_ACTIVE_HIGH>;');
    const without = generateOverlay(TEST_CHIP, { usesDisplay: true }, DEFAULT_ZEPHYR_DISPLAY_PROFILE);
    expect(without).not.toContain('te-gpios');
  });

  it('emits the ST7796S compatible + gamma for the st7796 profile', () => {
    const txt = generateOverlay(
      TEST_CHIP, { usesDisplay: true }, ZEPHYR_DISPLAY_PROFILES['st7796-zephyr'],
    );
    expect(txt).toContain('compatible = "sitronix,st7796s"');
    // pgc/ngc are required props of the sitronix binding; madctl carries the
    // rotation/BGR bits the direct-drive init expects.
    expect(txt).toContain('madctl = <0x28>');
    expect(txt).toContain('pgc = [');
    expect(txt).toContain('ngc = [');
  });

  it('emits an FT6336U I2C touch node by default when touch is used', () => {
    const txt = generateOverlay(
      TEST_CHIP,
      { usesDisplay: true, usesTouch: true },
      DEFAULT_ZEPHYR_DISPLAY_PROFILE,
      undefined,
      { irq: 9 },
    );
    expect(txt).toContain('ft6336u: ft6336u@38');
    expect(txt).not.toContain('xpt2046');
  });

  it('emits an XPT2046 SPI touch node with the in-tree binding shape', () => {
    const txt = generateOverlay(
      TEST_CHIP,
      { usesDisplay: true, usesTouch: true },
      DEFAULT_ZEPHYR_DISPLAY_PROFILE,
      { cs: 5 },
      { controller: 'xpt2046', cs: 6, irq: 7, minPressure: 350,
        calibration: { xMin: 200, xMax: 3900, yMin: 180, yMax: 3800 } },
    );
    expect(txt).toContain('xpt2046: xpt2046@1');
    expect(txt).toContain('compatible = "xptek,xpt2046"');
    expect(txt).toContain('reg = <1>');
    expect(txt).toContain('spi-max-frequency = <2500000>');
    // int-gpios + calibration are required props of the xptek binding.
    expect(txt).toContain('int-gpios = <&gpio0 7 GPIO_ACTIVE_LOW>');
    expect(txt).toContain('min-x = <200>');
    expect(txt).toContain('max-x = <3900>');
    expect(txt).toContain('min-y = <180>');
    expect(txt).toContain('max-y = <3800>');
    expect(txt).toContain('z-threshold = <350>');
    // touchscreen size comes from the display profile's effective size.
    expect(txt).toContain('touchscreen-size-x = <320>');
    expect(txt).toContain('touchscreen-size-y = <240>');
    // The touch CS is the SECOND cs-gpios entry (display keeps index 0).
    expect(txt).toContain(
      'cs-gpios = <&gpio0 5 GPIO_ACTIVE_LOW>, <&gpio0 6 GPIO_ACTIVE_LOW>;',
    );
    expect(txt).not.toContain('ft6336u');
  });

  it('emits the XPT2046 node standalone (no display) with its own bus block', () => {
    const txt = generateOverlay(
      TEST_CHIP, { usesTouch: true }, undefined, undefined,
      { controller: 'xpt2046', cs: 6, irq: 7 },
    );
    expect(txt).toContain('xpt2046: xpt2046@1');
    // Without a display block, the touch CS is the only cs-gpios entry.
    expect(txt).toContain('cs-gpios = <&gpio0 6 GPIO_ACTIVE_LOW>;');
    // Full-scale calibration defaults satisfy the binding's required props.
    expect(txt).toContain('max-x = <4095>');
  });

  it('omits unused peripherals', () => {
    const txt = generateOverlay(TEST_CHIP, { usesI2c: false }, undefined);
    expect(txt).not.toContain('&spi2');
  });

  it('has a header comment marking it auto-generated', () => {
    const txt = generateOverlay(TEST_CHIP, {}, undefined);
    expect(txt).toContain('Auto-generated');
  });

  it('omits the backlight node when no backlightPin is configured', () => {
    // A panel whose backlight is hardwired to power must not emit a backlight
    // gpio-leds node or alias — doing so would steal a GPIO (demo-st's
    // hardcoded pin 4 previously collided with the FT6336U reset-gpios).
    const txt = generateOverlay(
      TEST_CHIP, { usesDisplay: true }, DEFAULT_ZEPHYR_DISPLAY_PROFILE,
    );
    expect(txt).not.toContain('bl_led');
    expect(txt).not.toContain('bl-gpio-leds');
    expect(txt).not.toContain('backlight = &bl_led');
  });

  it('emits the backlight node on the configured pin when backlightPin is set', () => {
    const txt = generateOverlay(
      TEST_CHIP, { usesDisplay: true }, DEFAULT_ZEPHYR_DISPLAY_PROFILE,
      { backlightPin: 33 },
    );
    expect(txt).toContain('backlight = &bl_led');
    expect(txt).toContain('bl-gpio-leds');
    // Pin 33 is on gpio1 (ESP32-S3: 32-48 → gpio1).
    expect(txt).toContain('gpios = <&gpio1 33 GPIO_ACTIVE_HIGH>');
  });

  it('warns when an I2C touch controller has no sda/scl pins', () => {
    // The overlay would enable i2c0 + the FT6336U node but assign no pins —
    // every I2C read fails and touch silently does nothing (the bug that
    // left demo-shadcn without touch while demo-st worked).
    const diags: Array<{ severity: string; message: string }> = [];
    generateOverlay(
      TEST_CHIP,
      { usesI2c: true, usesTouch: true, touchController: 'ft6336u' },
      undefined,
      undefined,
      { controller: 'ft6336u', irq: 15, resetPin: 4 },
      diags,
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toContain('sda/scl');
    // With pins: no warning, and the overlay remuxes the bus.
    const diags2: Array<{ severity: string; message: string }> = [];
    const txt = generateOverlay(
      TEST_CHIP,
      { usesI2c: true, usesTouch: true, touchController: 'ft6336u' },
      undefined,
      undefined,
      { controller: 'ft6336u', irq: 15, resetPin: 4, sda: 8, scl: 9 },
      diags2,
    );
    expect(diags2).toHaveLength(0);
    expect(txt).toContain('I2C0_SDA_GPIO8');
    // SPI touch controllers are unaffected.
    const diags3: Array<{ severity: string; message: string }> = [];
    generateOverlay(
      TEST_CHIP,
      { usesSpi: true, usesTouch: true, touchController: 'xpt2046' },
      undefined,
      undefined,
      { controller: 'xpt2046' },
      diags3,
    );
    expect(diags3).toHaveLength(0);
  });

  describe('synthesized PWM + ADC pinctrl (Black Pill)', () => {
    it('emits pwm-leds consumers + tc-pwm<pin> aliases for synthesized specs', () => {
      const txt = generateOverlay(BLACKPILL, { usesPwm: true }, undefined);
      // The STM32 SoC dtsi ships a LABEL-LESS pwm child — the overlay
      // defines pwm4: pwm inside &timers4 (what the pwms cell references).
      expect(txt).toContain('&timers4 {');
      expect(txt).toContain('pwm4: pwm {');
      expect(txt).toContain('compatible = "pwm-leds"');
      expect(txt).toContain('tc_pwm_22: pwm-led-22 {');
      expect(txt).toContain('pwms = <&pwm4 1 20000000 PWM_POLARITY_NORMAL>');
      expect(txt).toContain('pwms = <&pwm4 2 20000000 PWM_POLARITY_NORMAL>');
      expect(txt).toContain('tc-pwm22 = &tc_pwm_22;');
      expect(txt).toContain('tc-pwm23 = &tc_pwm_23;');
    });

    it('derives st,prescaler on the timers node so the period fits the 16-bit ARR', () => {
      // 20 ms @ 96 MHz = 1.92M cycles; divider = ceil(1.92e6 / 65536) = 30
      // → cycles 64000, binding value divider-1 = 29.
      const txt = generateOverlay(BLACKPILL, { usesPwm: true }, undefined);
      expect(txt).toContain('&timers4 {');
      expect(txt).toContain('st,prescaler = <29>;');
    });

    it('emits no prescaler override when the period already fits 16 bits', () => {
      const chip = {
        ...BLACKPILL,
        pwm: { specs: [{ pin: 22, controller: 'pwm4', channel: 1, periodNs: 500_000 }], clockHz: 96_000_000 },
      } as typeof BLACKPILL;
      const txt = generateOverlay(chip, { usesPwm: true, pwmUsedPins: [22] }, undefined);
      expect(txt).not.toContain('st,prescaler');
    });

    it('emits no prescaler without a declared timer clock (unknown SoC clock)', () => {
      const noClock = { ...BLACKPILL, pwm: { specs: BLACKPILL.pwm!.specs } } as typeof BLACKPILL;
      const txt = generateOverlay(noClock, { usesPwm: true }, undefined);
      expect(txt).not.toContain('st,prescaler');
    });

    it('synthesizes pwm-leds consumers only for the driven pins (no dead DT channels)', () => {
      const txt = generateOverlay(BLACKPILL, { usesPwm: true, pwmUsedPins: [22] }, undefined);
      expect(txt).toContain('tc-pwm22 = &tc_pwm_22;');
      expect(txt).not.toContain('tc_pwm_23');
      expect(txt).not.toContain('pwm4 2 ');
    });

    it('omits PWM nodes when the program uses none (the lowering emits no DT_ALIAS refs)', () => {
      const txt = generateOverlay(BLACKPILL, {}, undefined);
      expect(txt).not.toContain('pwm-leds');
      expect(txt).not.toContain('tc-pwm');
    });

    it('rewrites the ADC pinctrl to exactly the channels the program reads', () => {
      const txt = generateOverlay(BLACKPILL, { usesAdc: true, adcReadPins: [0, 16] }, undefined);
      expect(txt).toContain('&adc1 {');
      expect(txt).toContain('pinctrl-0 = <&adc1_in0_pa0 &adc1_in8_pb0>;');
      expect(txt).not.toContain('adc1_in1_pa1');
    });

    it('emits a status-only ADC block when no channels carry pinctrl labels (nRF-style chips)', () => {
      const txt = generateOverlay(TEST_CHIP, { usesAdc: true }, undefined);
      expect(txt).toContain('&adc {');
      expect(txt).not.toContain('pinctrl-0');
    });
  });

  describe('usb CDC-ACM composition', () => {
    it('enables the UDC controller + declares one cdc_acm_uart child per instance', () => {
      const txt = generateOverlay(BLACKPILL, { usesUsb: true }, undefined);
      expect(txt).toContain('&zephyr_udc0 {');
      expect(txt).toContain('status = "okay";');
      expect(txt).toContain('cdc_acm_uart0: cdc-acm-uart0 {');
      expect(txt).toContain('compatible = "zephyr,cdc-acm-uart";');
      // No second instance — the board declares cdcInstances: 1.
      expect(txt).not.toContain('cdc_acm_uart1');
    });

    it('composes multiple CDC instances when the descriptor declares them', () => {
      const chip = { ...TEST_CHIP, usb: { controller: 'zephyr_udc0', cdcInstances: 2 } } as typeof TEST_CHIP;
      const txt = generateOverlay(chip, { usesUsb: true }, undefined);
      expect(txt).toContain('cdc_acm_uart0: cdc-acm-uart0 {');
      expect(txt).toContain('cdc_acm_uart1: cdc-acm-uart1 {');
    });

    it('omits USB nodes when the program uses none', () => {
      const txt = generateOverlay(BLACKPILL, {}, undefined);
      expect(txt).not.toContain('zephyr_udc0');
      expect(txt).not.toContain('cdc-acm-uart');
    });

    it('omits USB nodes for a chip that declares no usb capability', () => {
      const noUsb = { ...TEST_CHIP, usb: undefined } as typeof TEST_CHIP;
      const txt = generateOverlay(noUsb, { usesUsb: true }, undefined);
      expect(txt).not.toContain('zephyr_udc0');
      expect(txt).not.toContain('cdc-acm-uart');
    });

    it('does not rebind the console for plain USB usage (USB0 alone)', () => {
      const txt = generateOverlay(BLACKPILL, { usesUsb: true }, undefined);
      expect(txt).toContain('cdc_acm_uart0: cdc-acm-uart0 {');
      expect(txt).not.toContain('zephyr,console');
    });
  });
});

describe('storage partition synthesis (Preferences/FS on boards without one)', () => {
  it('declares the descriptor storage region + the /chosen settings pointer under usesPreferences', () => {
    // The Black Pill DTS ships only the MCUboot boot/slot/scratch set — the
    // overlay must synthesize storage_partition from zephyr.storage (256 KB
    // at 0x40000 = exactly the two last 128 KB flash pages, the ZMS minimum)
    // or the settings backend's FIXED_PARTITION_ID(storage_partition) dangles.
    const txt = generateOverlay(BLACKPILL, { usesPreferences: true }, undefined);
    expect(txt).toContain('storage_partition: partition@40000');
    expect(txt).toContain('reg = <0x00040000 0x00040000>');
    expect(txt).toContain('label = "storage"');
    expect(txt).toContain('zephyr,settings-partition = &storage_partition');
  });

  it('synthesizes under usesFS too (littlefs mounts the same partition)', () => {
    const txt = generateOverlay(BLACKPILL, { usesFS: true }, undefined);
    expect(txt).toContain('storage_partition: partition@40000');
  });

  it('boards whose DTS already ships the partition get only the /chosen pointer', () => {
    // Redeclaring an existing node is a devicetree error — a board without
    // zephyr.storage (ESP32 devkits: partition@3b0000 in the board DTS) must
    // not get a synthesized partition.
    const txt = generateOverlay(TEST_CHIP, { usesPreferences: true }, undefined);
    expect(txt).not.toContain('partition@');
    expect(txt).toContain('zephyr,settings-partition = &storage_partition');
  });

  it('no Preferences/FS usage emits no storage lines at all', () => {
    const txt = generateOverlay(BLACKPILL, {}, undefined);
    expect(txt).not.toContain('storage_partition');
  });

  it('enables the watchdog node when wdt_* is used (STM32 iwdg ships disabled)', () => {
    const txt = generateOverlay(BLACKPILL, { usesWdt: true }, undefined);
    expect(txt).toContain('&iwdg');
    expect(txt).toContain('status = "okay"');
  });
});

// RP2040 carries the synthesized uart1 pinctrl entry (no default group in
// the mainline board DT) — from the consolidated soc registry like the
// Black Pill fixture above.
const RP2040 = {
  ...chipForBoard('rpi_pico/rp2040'),
  i2c: { controllers: [{ nodeLabel: 'i2c0' }] },
  uart: {
    controllers: [
      { nodeLabel: 'uart0' },
      {
        nodeLabel: 'uart1',
        pinctrl: {
          include: 'zephyr/dt-bindings/pinctrl/rpi-pico-rp2040-pinctrl.h',
          pinmux: ['UART1_TX_P8'],
          inputPinmux: ['UART1_RX_P9'],
        },
        props: ['current-speed = <115200>;'],
      },
    ],
  },
};

describe('generateOverlay pinctrl synthesis', () => {
  it('synthesizes a pinctrl group and wires it onto the controller', () => {
    const txt = generateOverlay(RP2040, { usesUart: true, uartUsedInstances: [1] }, undefined);
    expect(txt).toContain('#include <zephyr/dt-bindings/pinctrl/rpi-pico-rp2040-pinctrl.h>');
    expect(txt).toContain('&pinctrl {');
    expect(txt).toContain('uart1_default: uart1_default {');
    expect(txt).toContain('pinmux = <UART1_TX_P8>;');
    expect(txt).toContain('pinmux = <UART1_RX_P9>;');
    expect(txt).toContain('input-enable;');
    expect(txt).toContain('&uart1 {');
    expect(txt).toContain('pinctrl-0 = <&uart1_default>;');
    expect(txt).toContain('pinctrl-names = "default";');
    expect(txt).toContain('status = "okay";');
    // The include must precede the blocks that reference its tokens.
    expect(txt.indexOf('rpi-pico-rp2040-pinctrl.h')).toBeLessThan(txt.indexOf('UART1_TX_P8'));
  });

  it('leaves controllers without synthesis data in plain enable form', () => {
    const txt = generateOverlay(RP2040, { usesI2c: true }, undefined);
    expect(txt).toContain('&i2c0 {');
    expect(txt).not.toContain('&pinctrl {');
    expect(txt).not.toContain('rpi-pico-rp2040-pinctrl.h');
  });

  it('carries the synthesis data through the board-constants flattener', () => {
    // uart0 = console (no synthesis data), uart1 = synthesized on GP8/GP9.
    expect(RP2040.uart?.controllers).toHaveLength(2);
    expect(RP2040.uart?.controllers[0]).toEqual({ nodeLabel: 'uart0' });
    expect(RP2040.uart?.controllers[1].pinctrl).toEqual({
      include: 'zephyr/dt-bindings/pinctrl/rpi-pico-rp2040-pinctrl.h',
      pinmux: ['UART1_TX_P8'],
      inputPinmux: ['UART1_RX_P9'],
    });
  });
});

// The ESP32-S3 descriptor resolved through the real board-package flattener —
// same path a real build takes, so the matrix assertions below also cover
// resolve.ts's zephyr.pwm.matrix.* parsing.
const ESP32S3 = {
  ...chipForBoard('esp32s3_devkitc/esp32s3/procpu'),
  pwm: {
    specs: [],
    // 19 excluded — the USB/flash/console pads the filter test expects to
    // be dropped from the used list before channel assignment.
    matrix: { controller: 'ledc0', channelCount: 8, pins: Array.from({ length: 49 }, (_, i) => i).filter((p) => p !== 19) },
    clockHz: 80000000,
  },
  usb: { controller: 'zephyr_udc0', cdcInstances: 1 },
};

describe('matrix PWM (ESP32-S3 LEDC) + USB overlay', () => {
  it('emits pinctrl pinmux tokens + channel children + pwm-leds for the driven pins', () => {
    const txt = generateOverlay(ESP32S3, { usesPwm: true, pwmUsedPins: [4, 12] }, undefined);
    // The pwms cell's PWM_POLARITY_NORMAL macro is not in every board's DTS
    // include chain (the ESP32-S3 chain has no PWM nodes) — the overlay
    // carries its own dt-bindings include or dtc rejects the cell ("expected
    // number or parenthesized expression", found by the E2E west build).
    expect(txt).toContain('#include <zephyr/dt-bindings/pwm/pwm.h>');
    expect(txt).toContain('&pinctrl {');
    expect(txt).toContain('tc_ledc0_default: tc-ledc0-default {');
    expect(txt).toContain('pinmux = <LEDC_CH0_GPIO4>, <LEDC_CH1_GPIO12>;');
    expect(txt).toContain('&ledc0 {');
    expect(txt).toContain('pinctrl-0 = <&tc_ledc0_default>;');
    expect(txt).toContain('channel0@0 {');
    expect(txt).toContain('channel1@1 {');
    expect(txt).toContain('timer = <0>;');
    // Channels are assigned ascending over the driven pins — the alias var
    // in the emitted C++ and the pwms cell here must agree on the pin.
    expect(txt).toContain('pwms = <&ledc0 0 20000000 PWM_POLARITY_NORMAL>');
    expect(txt).toContain('pwms = <&ledc0 1 20000000 PWM_POLARITY_NORMAL>');
    expect(txt).toContain('tc-pwm4 = &tc_pwm_4;');
    expect(txt).toContain('tc-pwm12 = &tc_pwm_12;');
  });

  it('filters pins outside the matrix from the used list (USB/flash/console pads)', () => {
    const txt = generateOverlay(ESP32S3, { usesPwm: true, pwmUsedPins: [4, 19] }, undefined);
    expect(txt).toContain('tc-pwm4 = &tc_pwm_4;');
    expect(txt).not.toContain('tc_pwm_19');
    expect(txt).not.toContain('GPIO19');
  });

  it('throws when the driven pins exceed the controller channel count', () => {
    const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(() => generateOverlay(ESP32S3, { usesPwm: true, pwmUsedPins: nine }, undefined))
      .toThrow(/exposes only 8 channels/);
  });

  it('omits PWM nodes when the program uses none', () => {
    const txt = generateOverlay(ESP32S3, {}, undefined);
    expect(txt).not.toContain('pwm-leds');
    expect(txt).not.toContain('ledc0');
  });

  it('composes the CDC-ACM instance under the board zephyr_udc0 alias on usb use', () => {
    const txt = generateOverlay(ESP32S3, { usesUsb: true }, undefined);
    expect(txt).toContain('&zephyr_udc0 {');
    expect(txt).toContain('cdc_acm_uart0: cdc-acm-uart0 {');
    expect(txt).toContain('compatible = "zephyr,cdc-acm-uart";');
  });
});
