import { describe, it, expect } from 'vitest';
import { usbdDeviceLines } from '../../../packages/framework-zephyr/src/lowering/usb';
import { SOC_CHIPS } from '../../../packages/framework-zephyr/src/chips/soc/index';
import type { BoardConstants } from '../../../packages/cuttlefish/src/api/shared/board-resolver';
import { resolveChipFromBoard } from '../../../packages/framework-zephyr/src/chips/resolve';
import type { ZephyrChipDescriptor } from '../../../packages/framework-zephyr/src/chips/types';

const BASE: ZephyrChipDescriptor = {
  id: 'nano_33_iot', soc: 'samd21',
  gpioController: 'porta',
  gpio: { dtSpecs: [] },
  usb: { controller: 'zephyr_udc0', cdcInstances: 1 },
};

const TOUCH: ZephyrChipDescriptor = {
  ...BASE,
  usb: {
    ...BASE.usb!,
    touchReset: {
      flagAddress: 0x20007ffc,
      magic: 0x07738135,
      bootloaderVid: '0x2341',
      bootloaderPid: '0x0057',
    },
  },
};

describe('touch-reset device shim emission (usbdDeviceLines)', () => {
  it('emits the msg callback + registration only when touchReset is declared', () => {
    const lines = usbdDeviceLines(TOUCH).join('\n');
    expect(lines).toContain('USBD_MSG_CDC_ACM_LINE_CODING');
    expect(lines).toContain('uart_config_get(msg->dev, &__tc_cfg) == 0 && __tc_cfg.baudrate == 1200');
    // SAMD21G18A flag word + the Arduino SAMD DBL_TAP magic.
    expect(lines).toContain('*(volatile uint32_t*)0x20007ffc = 0x7738135;');
    expect(lines).toContain('NVIC_SystemReset();');
    expect(lines).toContain('usbd_msg_register_cb(&__tc_usbd, __tc_usbd_msg_cb);');
    // Registered BEFORE usbd_init so no line-coding event can be missed.
    const cbAt = lines.indexOf('usbd_msg_register_cb');
    const initAt = lines.indexOf('err = usbd_init');
    expect(cbAt).toBeGreaterThan(-1);
    expect(cbAt).toBeLessThan(initAt);

    // Without touchReset: no callback, no registration.
    const plain = usbdDeviceLines(BASE).join('\n');
    expect(plain).not.toContain('__tc_usbd_msg_cb');
    expect(plain).not.toContain('usbd_msg_register_cb');
    expect(plain).not.toContain('NVIC_SystemReset');
  });
});

describe('touch-reset descriptor resolution (board package)', () => {
  it('round-trips zephyr.usb.touchReset from the nano-33-iot board constants', () => {
    const chip = SOC_CHIPS['samd21g18a'];
    expect(chip?.usb?.touchReset).toEqual({
      flagAddress: 0x20007ffc,
      magic: 0x07738135,
      bootloaderVid: '0x2341',
      bootloaderPid: '0x0057',
    });
  });

  it('boards without touchReset data resolve usb without the field', () => {
    const chip = SOC_CHIPS['stm32f411xe'];
    expect(chip?.usb).toBeDefined();
    expect(chip?.usb?.touchReset).toBeUndefined();
  });
});
