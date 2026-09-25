// ---------------------------------------------------------------------------
// hid-token-guard.test.ts — the HID token tables are a compile-time contract
// with Zephyr's <usb/class/hid.h>: every KEY.*/MOUSE.* token the hal surface
// documents must map to a macro that header actually defines (HID_KEY_SYSRQ,
// HID_KBD_MODIFIER_LEFT_UI — the spellings that differ from the datasheet
// names are exactly where past drift broke builds). Soft-guarded: machines
// without a Zephyr tree skip; machines with one fail loudly on drift.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { locateZephyrBaseCheap } from '../../../packages/cuttlefish/src/board-catalog/store';
import { hidTokenToMacro, isHidModifierToken, KEY_MODIFIER_TOKENS } from '../../../packages/framework-zephyr/src/lowering/hid';
import { KEY, MOUSE } from '../../../packages/hal/src/hid';

const base = locateZephyrBaseCheap();
const hasTree = base !== undefined;

describe('HID token ↔ Zephyr hid.h drift guard', () => {
  it('every hal KEY token maps to a macro Zephyr defines', () => {
    if (!hasTree || !base) return; // no tree on this machine — nothing to check against
    const header = readFileSync(join(base, 'include', 'zephyr', 'usb', 'class', 'hid.h'), 'utf8');
    const defined = new Set([...header.matchAll(/\b(HID_KEY_[A-Z0-9_]+|HID_KBD_MODIFIER_[A-Z_]+)\b/g)].map((m) => m[1]));
    // Same two-branch dispatch as lowerHid: modifiers are bitmask macros,
    // everything else a usage-code macro slotted into the report.
    for (const token of Object.keys(KEY)) {
      const macro = isHidModifierToken(`KEY.${token}`)
        ? KEY_MODIFIER_TOKENS[token]
        : hidTokenToMacro(`KEY.${token}`, 'key');
      expect(
        defined.has(macro!),
        `KEY.${token} lowers to ${macro}, which Zephyr's hid.h does not define`,
      ).toBe(true);
    }
  });

  it('every hal MOUSE token maps to a Zephyr-compatible bitmask expression', () => {
    // MOUSE tokens lower to BIT(n) — the guard is that lowering succeeds and
    // stays within the boot report's 3 button bits.
    for (const token of Object.keys(MOUSE)) {
      expect(() => hidTokenToMacro(`MOUSE.${token}`, 'button')).not.toThrow();
    }
  });
});
