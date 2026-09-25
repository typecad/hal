// ---------------------------------------------------------------------------
// HID lowering — USB keyboard/mouse over the Zephyr "next" device stack
//
// One HID interface per program (Zephyr's zephyr,hid-device node — a v1
// ceiling like the nRF PWM matrix: Keyboard OR Mouse, not both). The shim
// block declares the interface device + the boot report buffer + the report
// descriptor macro; the overlay generator synthesizes the DT node with the
// protocol the program uses (key verbs → keyboard, mouse verbs → mouse).
// Key/button arguments arrive as KEY.*/MOUSE.* token text (or runtime
// expressions) — the token map below translates name-for-name onto Zephyr's
// HID_KEY_* / button macros, with a build error naming the valid spellings.
// ----------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';

/** KEY.* token → Zephyr usage macro. Digits and the four modifiers are the
 *  spellings that differ; everything else maps name-for-name. */
const KEY_TOKENS: Record<string, string> = {
  A: 'HID_KEY_A', B: 'HID_KEY_B', C: 'HID_KEY_C', D: 'HID_KEY_D', E: 'HID_KEY_E',
  F: 'HID_KEY_F', G: 'HID_KEY_G', H: 'HID_KEY_H', I: 'HID_KEY_I', J: 'HID_KEY_J',
  K: 'HID_KEY_K', L: 'HID_KEY_L', M: 'HID_KEY_M', N: 'HID_KEY_N', O: 'HID_KEY_O',
  P: 'HID_KEY_P', Q: 'HID_KEY_Q', R: 'HID_KEY_R', S: 'HID_KEY_S', T: 'HID_KEY_T',
  U: 'HID_KEY_U', V: 'HID_KEY_V', W: 'HID_KEY_W', X: 'HID_KEY_X', Y: 'HID_KEY_Y',
  Z: 'HID_KEY_Z',
  N1: 'HID_KEY_1', N2: 'HID_KEY_2', N3: 'HID_KEY_3', N4: 'HID_KEY_4', N5: 'HID_KEY_5',
  N6: 'HID_KEY_6', N7: 'HID_KEY_7', N8: 'HID_KEY_8', N9: 'HID_KEY_9', N0: 'HID_KEY_0',
  ENTER: 'HID_KEY_ENTER', ESC: 'HID_KEY_ESC', BACKSPACE: 'HID_KEY_BACKSPACE',
  TAB: 'HID_KEY_TAB', SPACE: 'HID_KEY_SPACE',
  MINUS: 'HID_KEY_MINUS', EQUAL: 'HID_KEY_EQUAL',
  LEFTBRACE: 'HID_KEY_LEFTBRACE', RIGHTBRACE: 'HID_KEY_RIGHTBRACE',
  BACKSLASH: 'HID_KEY_BACKSLASH', SEMICOLON: 'HID_KEY_SEMICOLON',
  APOSTROPHE: 'HID_KEY_APOSTROPHE', GRAVE: 'HID_KEY_GRAVE',
  COMMA: 'HID_KEY_COMMA', DOT: 'HID_KEY_DOT', SLASH: 'HID_KEY_SLASH',
  CAPSLOCK: 'HID_KEY_CAPSLOCK',
  F1: 'HID_KEY_F1', F2: 'HID_KEY_F2', F3: 'HID_KEY_F3', F4: 'HID_KEY_F4',
  F5: 'HID_KEY_F5', F6: 'HID_KEY_F6', F7: 'HID_KEY_F7', F8: 'HID_KEY_F8',
  F9: 'HID_KEY_F9', F10: 'HID_KEY_F10', F11: 'HID_KEY_F11', F12: 'HID_KEY_F12',
  // Zephyr names usage 70 HID_KEY_SYSRQ (the /* PRINTSCREEN */ comment is
  // its only mention of the name) — the HAL token keeps the datasheet word.
  PRINTSCREEN: 'HID_KEY_SYSRQ', SCROLLLOCK: 'HID_KEY_SCROLLLOCK',
  PAUSE: 'HID_KEY_PAUSE', INSERT: 'HID_KEY_INSERT', HOME: 'HID_KEY_HOME',
  PAGEUP: 'HID_KEY_PAGEUP', DEL: 'HID_KEY_DELETE', END: 'HID_KEY_END',
  PAGEDOWN: 'HID_KEY_PAGEDOWN', RIGHT: 'HID_KEY_RIGHT', LEFT: 'HID_KEY_LEFT',
  DOWN: 'HID_KEY_DOWN', UP: 'HID_KEY_UP',
};

/** Modifier tokens — a separate bitmask enum in Zephyr (usage codes start
 *  at 4, which collides with modifier bits, so the two kinds CANNOT share
 *  one runtime branch: the lowering emits different code per kind).
 *  Exported for the hid.h drift-guard test (every mapped macro must exist
 *  in Zephyr's header). */
export const KEY_MODIFIER_TOKENS: Record<string, string> = {
  CTRL: 'HID_KBD_MODIFIER_LEFT_CTRL',
  SHIFT: 'HID_KBD_MODIFIER_LEFT_SHIFT',
  ALT: 'HID_KBD_MODIFIER_LEFT_ALT',
  // HID usage tables call the Windows/Apple/GUI key "UI" — Zephyr follows.
  GUI: 'HID_KBD_MODIFIER_LEFT_UI',
};

/** Is this KEY.* token a modifier (bitmask) rather than a usage code? */
export function isHidModifierToken(token: string): boolean {
  return token.startsWith('KEY.') && KEY_MODIFIER_TOKENS[token.slice(4)] !== undefined;
}

/** Map a modifier token to its Zephyr bitmask macro. */
function hidModifierMacro(token: string): string {
  return KEY_MODIFIER_TOKENS[token.slice(4)]!;
}

const MOUSE_TOKENS: Record<string, string> = {
  LEFT: 'BIT(0)', RIGHT: 'BIT(1)', MIDDLE: 'BIT(2)',
};

/** Map a KEY or MOUSE token (or pass a runtime expression through) to C. */
export function hidTokenToMacro(token: string, kind: 'key' | 'button'): string {
  const prefix = kind === 'key' ? 'KEY.' : 'MOUSE.';
  if (!token.startsWith(prefix)) return token; // runtime expression
  const name = token.slice(prefix.length);
  const table = kind === 'key' ? KEY_TOKENS : MOUSE_TOKENS;
  const mapped = table[name];
  if (!mapped) {
    const valid = Object.keys(table).map((k) => prefix + k).join(', ');
    throw new Error(
      `Unknown ${kind} token '${token}'. Valid spellings: ${valid} (or a runtime number expression).`,
    );
  }
  return mapped;
}

/**
 * Emit the HID interface state for one protocol. Called from shimLines when
 * the program uses hid.* — one device handle, one report buffer, the boot
 * report descriptor, and the guarded register helper that also starts the
 * shared usbd context (the same one CDC rides).
 */
export function hidInitLines(protocol: 'keyboard' | 'mouse'): string[] {
  // The boot descriptors: keyboard takes no args; mouse takes its button
  // count (3 — the MOUSE.LEFT/RIGHT/MIDDLE surface).
  const desc = protocol === 'keyboard' ? 'HID_KEYBOARD_REPORT_DESC()' : 'HID_MOUSE_REPORT_DESC(3)';
  // Driver-contract buffers: USB_STATIC_BUF_DEFINE gives pointer alignment
  // (the DWC2 driver rejects unaligned IN buffers with "Buffer not aligned"
  // and the completion still fires — every submit silently failed before
  // this) and the nocache section on builds that require it.
  const buf = protocol === 'keyboard'
    ? 'USB_STATIC_BUF_DEFINE(__tc_kb_report, 8);'
    : 'USB_STATIC_BUF_DEFINE(__tc_mouse_report, 4);';
  const pragmaWrap = protocol === 'mouse'
    ? [
        '#pragma GCC diagnostic push',
        '#pragma GCC diagnostic ignored "-Wnarrowing"',
      ]
    : [];
  const pragmaUnwrap = protocol === 'mouse' ? ['#pragma GCC diagnostic pop'] : [];
  return [
    '// CUTTLEFISH_HID_BEGIN',
    'static const struct device* __tc_hid_dev = DEVICE_DT_GET_ONE(zephyr_hid_device);',
    ...pragmaWrap,
    `static const uint8_t __tc_hid_desc[] = ${desc};`,
    ...pragmaUnwrap,
    buf,
    'static bool __tc_hid_registered = false;',
    // The API contract: get_report is required for every HID device type
    // (hid_dev_register rejects NULL ops with -EINVAL), set_protocol is
    // required for boot-subclass devices (both descriptors here), and
    // set_report when an output report is declared. Minimal stubs — the
    // verbs never read host->device state in v1.
    'static int __tc_hid_get_report(const struct device* dev, const uint8_t type, const uint8_t id, const uint16_t len, uint8_t* const buf) {',
    '    (void)dev; (void)type; (void)id; (void)len; (void)buf;',
    '    return -ENOTSUP;',
    '}',
    'static int __tc_hid_set_report(const struct device* dev, const uint8_t type, const uint8_t id, const uint16_t len, const uint8_t* const buf) {',
    '    (void)dev; (void)type; (void)id; (void)len; (void)buf;',
    '    return 0;',
    '}',
    'static void __tc_hid_set_protocol(const struct device* dev, const uint8_t protocol) {',
    '    (void)dev; (void)protocol;',
    '}',
    'static bool __tc_hid_ready = false;',
    'static void __tc_hid_iface_ready(const struct device* dev, const bool ready) {',
    '    (void)dev;',
    '    __tc_hid_ready = ready;',
    '}',
    'static uint32_t __tc_hid_idle = 0;',
    'static void __tc_hid_set_idle(const struct device* dev, const uint8_t id, const uint32_t duration) {',
    '    (void)dev; (void)id;',
    '    __tc_hid_idle = duration;',
    '}',
    'static uint32_t __tc_hid_get_idle(const struct device* dev, const uint8_t id) {',
    '    (void)dev; (void)id;',
    '    return __tc_hid_idle;',
    '}',
    'static void __tc_hid_output_report(const struct device* dev, const uint16_t len, const uint8_t* const buf) {',
    '    (void)dev; (void)len; (void)buf;',
    '}',
    'static const struct hid_device_ops __tc_hid_ops = {',
    '    .iface_ready = __tc_hid_iface_ready,',
    '    .get_report = __tc_hid_get_report,',
    '    .set_report = __tc_hid_set_report,',
    '    .set_idle = __tc_hid_set_idle,',
    '    .get_idle = __tc_hid_get_idle,',
    '    .set_protocol = __tc_hid_set_protocol,',
    '    .output_report = __tc_hid_output_report,',
    '};',
    'static void __tc_hid_register(void) {',
    '    if (__tc_hid_registered) { return; }',
    '    __tc_hid_registered = true;',
    '    int err = hid_device_register(__tc_hid_dev, __tc_hid_desc, sizeof(__tc_hid_desc), &__tc_hid_ops);',
    '    if (err != 0) { printk("typecad-hal hid: register failed: %d\\n", err); return; }',
    '    __tc_usbd_start();',
    '}',
    'static void __tc_hid_submit(const uint8_t* rep, uint16_t len) {',
    '    int err = hid_device_submit_report(__tc_hid_dev, len, rep);',
    '    // -EACCES is the normal pre-enumeration race (submit before the',
    '    // host configures the interface) — not worth a printk; every other',
    '    // errno (e.g. the alignment error that silently ate reports once)',
    '    // deserves to be loud.',
    '    if (err != 0 && err != -EACCES) { printk("typecad-hal hid: submit failed: %d\\n", err); }',
    '}',
    '// CUTTLEFISH_HID_END',
  ];
}

/**
 * Resolve a HAL hid.* op to Zephyr C++.
 * Returns `{ code }` for statement ops.
 */
export function lowerHid(op: HALOpIR, chip: ZephyrChipDescriptor): { code?: string; expression?: string } {
  if (!chip.usb) {
    throw new Error(
      `framework-zephyr: \`${op.operation}\` needs a USB device stack, but this board's chip data declares no \`zephyr.usb\` ` +
      `(controller + cdcInstances). Boards whose Zephyr DTS has no enabled UDC controller node ` +
      `(zephyr_udc0) cannot provide USB HID.`,
    );
  }
  const o = op as any;

  switch (op.operation) {
    case 'hid.kb_begin':
      return { code: '__tc_hid_register();' };
    case 'hid.kb_press': {
      // Modifier tokens are compile-time bitmasks — a different emit than
      // the usage-code slot logic (runtime expressions take the key path).
      if (isHidModifierToken(String(o.key))) {
        const mod = hidModifierMacro(String(o.key));
        return {
          code: `{ __tc_hid_register(); __tc_kb_report[0] = static_cast<uint8_t>(__tc_kb_report[0] | ${mod}); __tc_hid_submit(__tc_kb_report, 8U); }`,
        };
      }
      const key = hidTokenToMacro(String(o.key), 'key');
      return {
        code: `{ __tc_hid_register(); uint8_t __tc_k = static_cast<uint8_t>(${key}); for (uint32_t __tc_slot = 2U; __tc_slot < 8U; ++__tc_slot) { if (__tc_kb_report[__tc_slot] == 0U) { __tc_kb_report[__tc_slot] = __tc_k; break; } } __tc_hid_submit(__tc_kb_report, 8U); }`,
      };
    }
    case 'hid.kb_release': {
      if (isHidModifierToken(String(o.key))) {
        const mod = hidModifierMacro(String(o.key));
        return {
          code: `{ __tc_hid_register(); __tc_kb_report[0] = static_cast<uint8_t>(__tc_kb_report[0] & static_cast<uint8_t>(~${mod})); __tc_hid_submit(__tc_kb_report, 8U); }`,
        };
      }
      const key = hidTokenToMacro(String(o.key), 'key');
      return {
        code: `{ __tc_hid_register(); uint8_t __tc_k = static_cast<uint8_t>(${key}); for (uint32_t __tc_slot = 2U; __tc_slot < 8U; ++__tc_slot) { if (__tc_kb_report[__tc_slot] == __tc_k) { __tc_kb_report[__tc_slot] = 0U; } } __tc_hid_submit(__tc_kb_report, 8U); }`,
      };
    }
    case 'hid.kb_release_all':
      return {
        code: `{ __tc_hid_register(); for (uint32_t __tc_slot = 0U; __tc_slot < 8U; ++__tc_slot) { __tc_kb_report[__tc_slot] = 0U; } __tc_hid_submit(__tc_kb_report, 8U); }`,
      };
    case 'hid.mouse_begin':
      return { code: '__tc_hid_register();' };
    case 'hid.mouse_move': {
      return {
        code: `{ __tc_hid_register(); int32_t __tc_mx = static_cast<int32_t>(${o.dx}); int32_t __tc_my = static_cast<int32_t>(${o.dy}); int32_t __tc_mw = static_cast<int32_t>(${o.wheel}); if (__tc_mx > 127) { __tc_mx = 127; } if (__tc_mx < -127) { __tc_mx = -127; } if (__tc_my > 127) { __tc_my = 127; } if (__tc_my < -127) { __tc_my = -127; } if (__tc_mw > 127) { __tc_mw = 127; } if (__tc_mw < -127) { __tc_mw = -127; } __tc_mouse_report[1] = static_cast<uint8_t>(__tc_mx); __tc_mouse_report[2] = static_cast<uint8_t>(__tc_my); __tc_mouse_report[3] = static_cast<uint8_t>(__tc_mw); __tc_hid_submit(__tc_mouse_report, 4U); }`,
      };
    }
    case 'hid.mouse_press':
    case 'hid.mouse_release': {
      const btn = hidTokenToMacro(String(o.button), 'button');
      const opText = op.operation === 'hid.mouse_press' ? '|' : '&';
      const mask = op.operation === 'hid.mouse_press'
        ? btn
        : `static_cast<uint8_t>(~${btn})`;
      return {
        code: `{ __tc_hid_register(); __tc_mouse_report[0] = static_cast<uint8_t>(__tc_mouse_report[0] ${opText} ${mask}); __tc_hid_submit(__tc_mouse_report, 4U); }`,
      };
    }
    case 'hid.mouse_click': {
      const btn = hidTokenToMacro(String(o.button), 'button');
      return {
        code: `{ __tc_hid_register(); __tc_mouse_report[0] = static_cast<uint8_t>(__tc_mouse_report[0] | ${btn}); __tc_hid_submit(__tc_mouse_report, 4U); __tc_mouse_report[0] = static_cast<uint8_t>(__tc_mouse_report[0] & static_cast<uint8_t>(~${btn})); __tc_hid_submit(__tc_mouse_report, 4U); }`,
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
