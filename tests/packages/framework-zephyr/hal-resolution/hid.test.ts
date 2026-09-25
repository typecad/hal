// ---------------------------------------------------------------------------
// hid.test.ts — USB HID keyboard/mouse (hal/hid.ts): token mapping, report
// maintenance in the lowered C++, the overlay's zephyr,hid-device node, and
// the end-to-end resolver path. One HID interface per program (the v1
// ceiling); the protocol the program drives picks the node's protocol-code.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { ESP32S3_DEVKITC } from '../helpers/test-chip';
import { lowerHid, hidTokenToMacro, isHidModifierToken } from '../../../../packages/framework-zephyr/src/lowering/hid';
import { generateOverlay } from '../../../../packages/framework-zephyr/src/dt-config/overlay';

import { transpile, expectCppContains } from '../../../setup';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';

describe('hid token mapping', () => {
  it('maps KEY and MOUSE tokens name-for-name onto Zephyr macros', () => {
    expect(hidTokenToMacro('KEY.A', 'key')).toBe('HID_KEY_A');
    // Modifiers are a separate bitmask enum, not usage codes — they
    // classify into the modifier path (their macro emission is covered by
    // the lowering test below).
    expect(isHidModifierToken('KEY.CTRL')).toBe(true);
    expect(isHidModifierToken('KEY.SHIFT')).toBe(true);
    expect(isHidModifierToken('KEY.A')).toBe(false);
    expect(hidTokenToMacro('KEY.N1', 'key')).toBe('HID_KEY_1');
    // Buttons are plain bit masks (the Zephyr sample's convention).
    expect(hidTokenToMacro('MOUSE.LEFT', 'button')).toBe('BIT(0)');
    // Runtime expressions pass through untouched.
    expect(hidTokenToMacro('k', 'key')).toBe('k');
  });

  it('unknown tokens are build errors naming the convention', () => {
    expect(() => hidTokenToMacro('KEY.ARGH', 'key')).toThrow(/KEY\.ARGH.*KEY\.A/s);
  });
});

describe('hid lowering', () => {
  it('kb press slots keys; modifiers OR their bitmask into the report byte', () => {
    const press = lowerHid({ operation: 'hid.kb_press', key: 'KEY.A' } as any, ESP32S3_DEVKITC);
    expect(press.code).toContain('__tc_k = static_cast<uint8_t>(HID_KEY_A)');
    expect(press.code).toContain('if (__tc_kb_report[__tc_slot] == 0U) { __tc_kb_report[__tc_slot] = __tc_k; break; }');
    expect(press.code).toContain('__tc_hid_submit(__tc_kb_report, 8U)');
    const mod = lowerHid({ operation: 'hid.kb_press', key: 'KEY.CTRL' } as any, ESP32S3_DEVKITC);
    expect(mod.code).toContain('__tc_kb_report[0] = static_cast<uint8_t>(__tc_kb_report[0] | HID_KBD_MODIFIER_LEFT_CTRL)');
    const modRel = lowerHid({ operation: 'hid.kb_release', key: 'KEY.SHIFT' } as any, ESP32S3_DEVKITC);
    expect(modRel.code).toContain('~HID_KBD_MODIFIER_LEFT_SHIFT');
  });

  it('mouse move clamps to int8 and submits the 4-byte report', () => {
    const out = lowerHid({ operation: 'hid.mouse_move', dx: 'mx', dy: 'my', wheel: 0 } as any, ESP32S3_DEVKITC);
    expect(out.code).toContain('int32_t __tc_mx = static_cast<int32_t>(mx)');
    expect(out.code).toContain('if (__tc_mx > 127) { __tc_mx = 127; }');
    expect(out.code).toContain('__tc_hid_submit(__tc_mouse_report, 4U)');
  });

  it('the overlay synthesizes the zephyr,hid-device node (protocol-code none)', () => {
    // protocol-code stays "none" like Zephyr's own samples — the boot
    // keyboard/mouse codes made Windows discard input on this stack; the
    // report descriptor carries the real semantics either way.
    const overlay = generateOverlay(ESP32S3_DEVKITC, { usesHid: true, hidProtocol: 'keyboard' } as any, undefined);
    expect(overlay).toContain('compatible = "zephyr,hid-device";');
    expect(overlay).toContain('protocol-code = "none";');
    expect(overlay).toContain('in-report-size = <8>;');
  });
});

describe('hid end-to-end (esp32s3 target)', () => {
  it('Keyboard verbs flow through the resolver into report-maintenance C++', () => {
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('esp32s3_devkitc/esp32s3/procpu').boardJson).constants));
    const result = transpile(`
      import { Keyboard, KEY } from '@typecad/hal';

      const kb = new Keyboard();
      kb.begin();
      kb.press(KEY.CTRL);
      kb.press(KEY.A);
      kb.release(KEY.A);
      kb.releaseAll();
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'esp32s3_devkitc' } } as any,
    });

    expectCppContains(result, [
      'static const uint8_t __tc_hid_desc[] = HID_KEYBOARD_REPORT_DESC();',
      'static void __tc_hid_register(void)',
      'hid_device_register(__tc_hid_dev, __tc_hid_desc, sizeof(__tc_hid_desc), &__tc_hid_ops)',
      'static const struct hid_device_ops __tc_hid_ops = {',
      '.get_report = __tc_hid_get_report,',
      '__tc_kb_report[0] = static_cast<uint8_t>(__tc_kb_report[0] | HID_KBD_MODIFIER_LEFT_CTRL)',
      '__tc_k = static_cast<uint8_t>(HID_KEY_A)',
      '__tc_hid_submit(__tc_kb_report, 8U)',
    ]);
  });
});
