// USB CDC-ACM serial lowering — the "next" Zephyr USB device stack surface.
// A CDC-ACM instance registers as a UART-class device (cdc_acm_uart<N>,
// composed in the generated overlay), so the lowering shares the per-byte
// poll_out shape with uart.ts; what's USB-specific is the usb_enable() guard
// in begin, the DTR-based connected query, and the board-capability gate
// (boards whose chip descriptor declares no `usb` must fail loudly).
//
// Descriptor facts for the blackpill: OTG_FS on PA11/PA12, zephyr_udc0
// controller node in Zephyr 4.3's blackpill_f411ce DTS (disabled by default).

import { describe, it, expect } from 'vitest';
import { lowerUsb, usbInitLines, usbdDeviceLines } from '../../../../packages/framework-zephyr/src/lowering/usb';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';
import { SOC_CHIPS } from '../../../../packages/framework-zephyr/src/chips/soc/index';
import { setActiveChip } from '../../../../packages/framework-zephyr/src/chips/index';
import { transpile } from '../../../setup';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';
function generatedConstants(target: string): BoardConstants {
  const g = generateBoard(target);
  return new Map(Object.entries(JSON.parse(g.boardJson).constants)) as BoardConstants;
}


const BLACKPILL = SOC_CHIPS['stm32f411xe'];

const USB_CHIP = { ...XIAO_BLE, usb: { controller: 'zephyr_udc0', cdcInstances: 1 } } as typeof XIAO_BLE;
// The pre-USB XIAO shape — a capable chip that simply declares no `usb`.
const NO_USB_CHIP = { ...XIAO_BLE, usb: undefined } as typeof XIAO_BLE;

// The ESP32-S3 board package now declares its native USB-OTG (the board DTS
// ships `zephyr_udc0: &usb_otg { status = "okay"; }`); usb.* ops on the S3
// resolve through the same path as the blackpill/XIAO instead of failing the
// "board does not expose USB" gate.
const ESP32S3 = SOC_CHIPS['esp32s3'];

describe('usb init block', () => {
  it('esp32s3 board resolution exposes USB (native OTG via zephyr_udc0)', () => {
    expect(ESP32S3.usb?.controller).toBe('zephyr_udc0');
    expect(ESP32S3.usb?.cdcInstances).toBe(1);
    // usb.* ops must not throw on the S3 anymore.
    expect(() => lowerUsb({ operation: 'usb.println', port: 'USB0', value: '"hi"' } as any, ESP32S3)).not.toThrow();
  });

  it('emits the next-stack device context (USBD_DEVICE_DEFINE + descriptors + usbd_init + usbd_enable)', () => {
    const lines = usbdDeviceLines(USB_CHIP).join('\n');
    expect(lines).toContain('// CUTTLEFISH_USBD_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_USBD_END');
    expect(lines).toContain('USBD_DEVICE_DEFINE(__tc_usbd,');
    expect(lines).toContain('DT_NODELABEL(zephyr_udc0)');
    // Zephyr-test VID/PID defaults (0x2fe3/0x0001) unless the board overrides.
    expect(lines).toContain('0x2fe3, 0x0001');
    expect(lines).toContain('usbd_register_all_classes(&__tc_usbd, USBD_SPEED_FS, 1, NULL)');
    // usbd_init MUST come between class registration and usbd_enable —
    // usbd_enable refuses with -EPERM ("not initialized") without it.
    expect(lines.indexOf('usbd_register_all_classes')).toBeLessThan(lines.indexOf('usbd_init(&__tc_usbd)'));
    expect(lines.indexOf('usbd_init(&__tc_usbd)')).toBeLessThan(lines.indexOf('usbd_enable(&__tc_usbd)'));
    expect(lines).toContain('usbd_enable(&__tc_usbd)');
    // NOT the deprecated legacy-stack symbol/API.
    expect(lines).not.toContain('usb_enable(');
  });

  it('honors descriptor vid/pid overrides', () => {
    const custom = { ...USB_CHIP, usb: { ...USB_CHIP.usb!, vid: '0x1234', pid: '0x5678' } } as typeof USB_CHIP;
    const lines = usbdDeviceLines(custom).join('\n');
    expect(lines).toContain('0x1234, 0x5678');
    expect(lines).not.toContain('0x2fe3');
  });

  it('emits CUTTLEFISH_USB markers + the cdc_acm_uart device + a start-guarded helper', () => {
    const lines = usbInitLines(USB_CHIP, 0).join('\n');
    expect(lines).toContain('// CUTTLEFISH_USB_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_USB_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(cdc_acm_uart0))');
    expect(lines).toContain('__tc_usbd_start()');
  });

  it('emits nothing without a declared usb capability', () => {
    expect(usbdDeviceLines(NO_USB_CHIP)).toEqual([]);
    expect(usbInitLines(NO_USB_CHIP, 0)).toEqual([]);
  });
});

describe('usb lowering', () => {
  it('begin → device-stack start (no baud — CDC line coding is host-owned)', () => {
    expect(lowerUsb({ operation: 'usb.begin', port: 'USB0' } as any, USB_CHIP))
      .toEqual({ code: '__tc_usb0_init();' });
  });

  it('wait_ready → bounded DTR poll with k_msleep slices (expression)', () => {
    const out = lowerUsb({ operation: 'usb.wait_ready', port: 'USB0', timeoutMs: 5000 } as any, USB_CHIP);
    expect(out.expression).toContain('uart_line_ctrl_get(__tc_usb0_dev, UART_LINE_CTRL_DTR');
    expect(out.expression).toContain('k_msleep(10)');
    expect(out.expression).toContain('__t >= (uint32_t)(5000)');
  });

  it('print of a string literal → per-byte poll_out loop on the CDC device', () => {
    const out = lowerUsb({ operation: 'usb.print', port: 'USB0', value: '"hi"' } as any, USB_CHIP);
    expect(out.code).toContain('uart_poll_out(__tc_usb0_dev, ("hi")[__i])');
    expect(out.code).not.toContain('\\n');
  });

  it('println appends a newline', () => {
    const out = lowerUsb({ operation: 'usb.println', port: 'USB0', value: '"hi"' } as any, USB_CHIP);
    expect(out.code).toContain("uart_poll_out(__tc_usb0_dev, '\\n')");
  });


  it('read → non-blocking poll, byte or -1 (expression)', () => {
    const out = lowerUsb({ operation: 'usb.read', port: 'USB0' } as any, USB_CHIP);
    expect(out.expression).toContain('uart_poll_in(__tc_usb0_dev, &__b) == 0');
    expect(out.expression).toContain(': -1');
  });

  it('available → 0 (same poll-API honesty as uart)', () => {
    expect(lowerUsb({ operation: 'usb.available', port: 'USB0' } as any, USB_CHIP))
      .toEqual({ expression: '(0)' });
  });


  it('connected → DTR line-ctrl query (expression)', () => {
    const out = lowerUsb({ operation: 'usb.connected', port: 'USB0' } as any, USB_CHIP);
    expect(out.expression).toContain('uart_line_ctrl_get(__tc_usb0_dev, UART_LINE_CTRL_DTR');
    expect(out.expression).toContain('__dtr != 0');
  });

  it('throws a board-capability diagnostic when the chip declares no usb', () => {
    expect(() => lowerUsb({ operation: 'usb.println', port: 'USB0', value: '"hi"' } as any, NO_USB_CHIP))
      .toThrow(/zephyr\.usb/);
  });

  it('throws an out-of-range diagnostic for an instance beyond cdcInstances', () => {
    expect(() => lowerUsb({ operation: 'usb.println', port: 'USB1', value: '"hi"' } as any, USB_CHIP))
      .toThrow(/out of range/);
  });
});

describe('blackpill usb capability', () => {
  it('declares the zephyr_udc0 controller with one CDC instance', () => {
    expect(BLACKPILL?.usb).toEqual({ controller: 'zephyr_udc0', cdcInstances: 1, vid: '0x2FE3', pid: '0x0002' });
  });

  it('lowers USB0 println against the blackpill descriptor', () => {
    const out = lowerUsb({ operation: 'usb.println', port: 'USB0', value: '"hi"' } as any, BLACKPILL!);
    expect(out.code).toContain('__tc_usb0_dev');
  });
});

describe('USB0 end-to-end (transpile with the blackpill board package)', () => {
  it('lowers USB0.begin/println/connected to the CDC device shim calls', () => {
    setActiveChip(BLACKPILL!);
    const result = transpile(`
      const USB0 = 'USB0'; // composed CDC node
      USB0.open();
      USB0.writeLine("hi");
      if (USB0.ready()) { USB0.write("host open"); }
      USB0.waitReady(5000);
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      
      platformContext: { frameworkData: { target: 'blackpill_f411ce/stm32f411xe' } } as any,
    });

    expect(result.cpp).toContain('__tc_usb0_init();');
    expect(result.cpp).toContain('uart_poll_out(__tc_usb0_dev');
    expect(result.cpp).toContain('uart_line_ctrl_get(__tc_usb0_dev, UART_LINE_CTRL_DTR');
    // The shim block (device + usb_enable-guarded init) rides along.
    expect(result.cpp).toContain('DEVICE_DT_GET(DT_NODELABEL(cdc_acm_uart0))');
    expect(result.cpp).toContain('USBD_DEVICE_DEFINE(__tc_usbd,');
    expect(result.cpp).toContain('usbd_enable(&__tc_usbd)');
    expect(result.cpp).toContain('#include <zephyr/usb/usbd.h>');
    // STM32F4 targets also carry the DBGMCU keep-SWD-alive init — the
    // sleep-gated debug port is what makes openocd unable to re-attach
    // ("Failed to read memory at 0xe000ed04") on boards without an RST pad.
    expect(result.cpp).toContain('__tc_stm32_dbgmcu_keep_swd_alive');
    expect(result.cpp).toContain('0xE0042004');
    expect(result.cpp).toContain('SYS_INIT(__tc_stm32_dbgmcu_keep_swd_alive, PRE_KERNEL_1, 0);');
  });
});
