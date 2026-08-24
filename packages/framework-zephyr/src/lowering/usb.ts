// ---------------------------------------------------------------------------
// USB CDC-ACM serial lowering — Zephyr "next" USB device stack
//
// A CDC-ACM instance (cdc_acm_uart<N>, composed in the generated overlay as a
// child of the UDC controller node) registers as a UART-class device, so the
// lowering drives it with the plain uart_* API — the same per-byte poll_out
// loops as lowering/uart.ts. The differences from a hardware UART:
//   - usb.begin must start the device stack (usbdDeviceLines' one-shot
//     __tc_usbd_start) before the port carries traffic;
//   - "connected" is a real query (DTR line ctrl), not a constant;
//   - baud is a line-coding hint — recorded, but CDC has no wire baud.
//
// If the chip descriptor declares no `usb`, every op throws with a clear
// "board does not expose USB" message (the diagnostic contract the framework
// manifest's board-gated support entry promises).
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';
import { parseControllerIndex } from './util.js';
import { renderWrite } from './uart.js';

/** The C variable prefix for a CDC instance's state. */
function prefix(idx: number): string {
  return `__tc_usb${idx}`;
}

/** Instance N resolves to the DT nodelabel the overlay generator emits. */
function nodeLabel(idx: number): string {
  return `cdc_acm_uart${idx}`;
}

/**
 * Emit the shared USB device context (USBD_DEVICE_DEFINE + string/config
 * descriptors + configuration + class registration + usbd_enable). Emitted
 * ONCE per program when the chip declares `usb` — the next stack has one
 * device context on the UDC controller, regardless of how many CDC instances
 * hang off it.
 *
 * VID/PID default to the Zephyr-project testing IDs (0x2fe3/0x0001); a board
 * overrides via `zephyr.usb.vid`/`zephyr.usb.pid`. Full-speed only — the
 * boards this framework targets (STM32 OTG_FS, nRF USBD) are FS controllers,
 * and the HS path would need a second USBD_CONFIGURATION_DEFINE.
 *
 * Symbol/API shapes verified against Zephyr 4.3:
 * subsys/usb/device_next/Kconfig, include/zephyr/usb/usbd.h, and
 * samples/subsys/usb/common/sample_usbd_init.c.
 */
export function usbdDeviceLines(chip: ZephyrChipDescriptor): string[] {
  if (!chip.usb) return [];
  const vid = chip.usb.vid ?? '0x2fe3';
  const pid = chip.usb.pid ?? '0x0001';
  return [
    '// CUTTLEFISH_USBD_BEGIN',
    'USBD_DEVICE_DEFINE(__tc_usbd,',
    `    DEVICE_DT_GET(DT_NODELABEL(${chip.usb.controller})),`,
    `    ${vid}, ${pid});`,
    'USBD_DESC_LANG_DEFINE(__tc_usbd_lang);',
    'USBD_DESC_MANUFACTURER_DEFINE(__tc_usbd_mfr, "typecad");',
    'USBD_DESC_PRODUCT_DEFINE(__tc_usbd_product, "cuttlefish app");',
    'USBD_DESC_CONFIG_DEFINE(__tc_usbd_cfg_desc, "cuttlefish");',
    'USBD_CONFIGURATION_DEFINE(__tc_usbd_cfg, 0, 250, &__tc_usbd_cfg_desc);',
    'static bool __tc_usbd_started = false;',
    'static void __tc_usbd_start(void) {',
    '    if (__tc_usbd_started) { return; }',
    '    __tc_usbd_started = true;',
    '    int err = usbd_add_descriptor(&__tc_usbd, &__tc_usbd_lang);',
    '    if (err != 0) { printk("cuttlefish usb: lang descriptor failed: %d\\n", err); return; }',
    '    err = usbd_add_descriptor(&__tc_usbd, &__tc_usbd_mfr);',
    '    if (err != 0) { printk("cuttlefish usb: manufacturer descriptor failed: %d\\n", err); return; }',
    '    err = usbd_add_descriptor(&__tc_usbd, &__tc_usbd_product);',
    '    if (err != 0) { printk("cuttlefish usb: product descriptor failed: %d\\n", err); return; }',
    '    err = usbd_add_configuration(&__tc_usbd, USBD_SPEED_FS, &__tc_usbd_cfg);',
    '    if (err != 0) { printk("cuttlefish usb: add configuration failed: %d\\n", err); return; }',
    '    err = usbd_register_all_classes(&__tc_usbd, USBD_SPEED_FS, 1, NULL);',
    '    if (err != 0) { printk("cuttlefish usb: register classes failed: %d\\n", err); return; }',
    // usbd_init builds the descriptor tables from the registered
    // configuration/classes and marks the context initialized — usbd_enable
    // refuses with -EPERM ("not initialized") without it (sample_usbd_init.c
    // calls it between setup and enable).
    '    err = usbd_init(&__tc_usbd);',
    '    if (err != 0) { printk("cuttlefish usb: init failed: %d\\n", err); return; }',
    // Boards with VBUS detection start on the VBUS event in the Zephyr
    // sample, via a message callback we do not register; enabling
    // unconditionally (and reporting the error) is the sample's own path
    // for boards without detection (STM32 OTG_FS).
    '    err = usbd_enable(&__tc_usbd);',
    '    if (err != 0) { printk("cuttlefish usb: enable failed: %d\\n", err); return; }',
    '    printk("cuttlefish usb: device enabled\\n");',
    '}',
    '// CUTTLEFISH_USBD_END',
  ];
}

/**
 * Emit the per-instance CDC device + init helper. Called from shimLines when
 * the program uses USB and the chip declares `usb`; must be paired with one
 * usbdDeviceLines() block. The init starts the device stack (guarded) and
 * applies the line coding.
 */
export function usbInitLines(chip: ZephyrChipDescriptor, instanceIndex: number): string[] {
  if (!chip.usb) return [];
  const p = prefix(instanceIndex);
  const dev = `${p}_dev`;
  return [
    '// CUTTLEFISH_USB_BEGIN',
    `static const struct device* ${dev} = DEVICE_DT_GET(DT_NODELABEL(${nodeLabel(instanceIndex)}));`,
    `static void ${p}_init(uint32_t baud) {`,
    `    __tc_usbd_start();`,
    `    const struct uart_config cfg = { .baudrate = (baud ? baud : 115200), .parity = UART_CFG_PARITY_NONE, .stop_bits = UART_CFG_STOP_BITS_1, .data_bits = UART_CFG_DATA_BITS_8, .flow_ctrl = UART_CFG_FLOW_CTRL_NONE };`,
    `    uart_configure(${dev}, &cfg);`,
    `}`,
    '// CUTTLEFISH_USB_END',
  ];
}

/** Throw the board-capability diagnostic. Centralized so every op reads identically. */
function requireUsb(chip: ZephyrChipDescriptor, op: string): void {
  if (!chip.usb) {
    throw new Error(
      `framework-zephyr: \`${op}\` needs a USB device stack, but this board's chip data declares no \`zephyr.usb\` ` +
      `(controller + cdcInstances). Boards whose Zephyr DTS has no enabled UDC controller node ` +
      `(zephyr_udc0) cannot provide USB CDC serial.`,
    );
  }
}

/**
 * Resolve a HAL usb.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 */
export function lowerUsb(op: HALOpIR, chip: ZephyrChipDescriptor): { code?: string; expression?: string } {
  requireUsb(chip, op.operation);
  const o = op as any;
  const idx = parseControllerIndex(o.port);
  if (chip.usb && idx >= chip.usb.cdcInstances) {
    throw new Error(
      `framework-zephyr: usb port "${o.port}" (instance ${idx}) is out of range — this board composes ` +
      `${chip.usb.cdcInstances} CDC-ACM instance(s) (USB0..USB${chip.usb.cdcInstances - 1}).`,
    );
  }
  const p = prefix(idx);
  const dev = `${p}_dev`;

  switch (op.operation) {
    case 'usb.begin':
      return { code: `${p}_init(static_cast<uint32_t>(${o.baud}));` };
    case 'usb.end':
      // CDC has no per-port disable short of tearing down the device stack
      // (which would drop every other instance); make end observable but safe.
      return { code: `(void)${dev};` };
    case 'usb.print':
      return { code: renderWrite(dev, o.value, false) };
    case 'usb.println':
      return { code: renderWrite(dev, o.value, true) };
    case 'usb.write':
      return { code: renderWrite(dev, o.data, false) };
    case 'usb.printf': {
      const fmt = o.format;
      const args = (o.args ?? []).join(', ');
      const argList = args ? `, ${args}` : '';
      return {
        code: `char __buf[128]; int __n = snprintk(__buf, sizeof(__buf), ${fmt}${argList}); for (int __i = 0; __i < __n; __i++) { uart_poll_out(${dev}, __buf[__i]); }`,
      };
    }
    case 'usb.read':
      // Same poll semantics as uart.read: the byte or -1 if none available.
      return { expression: `({ unsigned char __b = 0; (uart_poll_in(${dev}, &__b) == 0) ? (int)__b : -1; })` };
    case 'usb.available':
      // uart_poll_in reports only "one byte ready" and probing would drain it;
      // same honest limitation as uart.available.
      return { expression: '(0)' };
    case 'usb.flush':
      return { code: `(void)${dev};` };
    case 'usb.connected':
      // DTR asserted = the host actually opened the port.
      return { expression: `({ uint32_t __dtr = 0; (uart_line_ctrl_get(${dev}, UART_LINE_CTRL_DTR, &__dtr) == 0) && (__dtr != 0); })` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
        `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
