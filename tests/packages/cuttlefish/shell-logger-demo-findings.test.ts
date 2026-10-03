// ---------------------------------------------------------------------------
// shell-logger-demo-findings.test.ts — regressions for the transpiler bugs
// the zephyr-shell-logger demo (demos/zephyr-shell-logger) surfaced — round 3
// of the find-issues series, exercising USB CDC, the File store, async boot,
// and the one-string-model text machinery on fresh shapes:
//
//   1. parseInt(text, RADIX) — the radix is the contract. atoi is base-10
//      only, so parseInt("2A", 16) parsed as 2 (every hex checksum failed).
//      Lowered to strtol with the literal base.
//   2. The shared __tc_dev_put write helper serves UART and CDC writes but
//      rode the CUTTLEFISH_UART marker family, which the setup.ts backstop
//      strips whenever usesUart is false — a USB-only program lost the
//      helper and every write failed to compile. It now carries its own
//      CUTTLEFISH_SERIAL_WRITE marker pair, stripped only when neither
//      serial surface is used.
//   3. The File path is a construction fact: `new File(SETTINGS_PATH)` with
//      a NAMED string constant left _path uncaptured and fs ops baked the
//      literal "this->_path". The capture const-folds named constants.
//   4. fs.write_text content was quoteNonIdentifier'd — a call expression
//      baked into a string literal. Values pass verbatim (std::string takes
//      .c_str()).
//   5. for (const ch of s) over a string: the old `const char* it, ch`
//      declarator made ch a CONST CHAR and its reassignment ill-formed.
//      Now an index loop over a once-evaluated string copy, loop var a
//      mutable char.
//   6. Number.parseInt/isNaN static forms are lowered (round 2) but the
//      eslint gate + semantic prescan still banned them — gate and lowering
//      now agree (only isInteger/isSafeInteger are banned).
//   7. for-of destructuring over a Map (for (const [k, v] of m)) is the
//      SUPPORTED shape (the lowering desugars patterns); the
//      no-destructured-without-init gate now exempts for-of declarators.
//   8. usb.read casts its byte via static_cast (C-style (int)__b tripped
//      AUTOSAR M5-0-7 on strict).
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpileZephyrStrategy } from '../../setup';

describe('shell-logger demo findings', () => {
  it('lowers parseInt with a literal radix to strtol (never base-10 atoi)', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const v = Number.parseInt('2A', 16);
      const d = parseInt('07', 10);
      UART0.writeLine(\`\${v} \${d}\`);
    `);
    expect(r.cpp).toMatch(/strtol\("2A", nullptr, 16\)/);
    expect(r.cpp).toMatch(/atoi\("07"\)/);
    expect(r.cpp).not.toMatch(/atoi\("2A"/);
  });

  it('keeps the shared serial-write helper on USB-only programs', () => {
    const r = transpileZephyrStrategy(`
      import { USB0 } from '@typecad/hal';
      USB0.writeLine('boot');
    `);
    // The helper definition ships (its own marker family, not the UART
    // driver block the usesUart backstop strips)…
    expect(r.cpp).toContain('static inline void __tc_dev_put(const struct device* dev, const char* s)');
    // …and the write uses it.
    expect(r.cpp).toMatch(/__tc_dev_put\(__tc_usb0_dev/);
  });

  it('folds a named path constant into the File construction fact', () => {
    const r = transpileZephyrStrategy(`
      import { File } from '@typecad/hal';
      const SETTINGS_PATH = 'session.cfg';
      const f = new File(SETTINGS_PATH);
      const t = f.read();
    `);
    expect(r.cpp).toMatch(/__tc_fs_read_text\("session\.cfg"\)/);
    expect(r.cpp).not.toContain('this->_path');
  });

  it('passes fs.write_text content verbatim with the c_str boundary', () => {
    const r = transpileZephyrStrategy(`
      import { File } from '@typecad/hal';
      const f = new File('state.txt');
      f.write('payload');
    `);
    expect(r.cpp).toMatch(/__tc_fs_write_text\("state\.txt", "payload"\)/);
    expect(r.cpp).not.toContain('"payload)"');
  });

  it('lowers for-of over a string to a mutable-char index loop', () => {
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      function cs(s: string): number {
        let x = 0;
        for (const ch of s) { x ^= ch.charCodeAt(0); }
        return x;
      }
      UART0.writeLine(cs('ab').toString(16));
    `);
    // A once-evaluated string copy + mutable char loop var…
    expect(r.cpp).toMatch(/const std::string __tc_str_s_\d+ = s;/);
    expect(r.cpp).toMatch(/for \(long long __tc_str_i_\d+ = 0, ch = 0;/);
    // …feeding the char-overloaded helper.
    expect(r.cpp).toMatch(/__tc_charCodeAt\(ch, 0\)/);
    expect(r.cpp).not.toMatch(/const char\* __tc_str_it = [^;]+, ch/);
  });

  it('agrees between the Number.* eslint ban and the lowerings', () => {
    // parseInt/parseFloat/isFinite/isNaN lower (round 2); only
    // isInteger/isSafeInteger remain banned. The gate must not fire on the
    // lowered four — transpile would abort before this assertion ran.
    const r = transpileZephyrStrategy(`
      import { UART0 } from '@typecad/hal';
      const a = Number.parseFloat('1.5');
      if (Number.isFinite(a)) { UART0.writeLine('ok'); }
    `);
    expect(r.cpp).toMatch(/atof\("1\.5"\)/);
    expect(r.cpp).toMatch(/std::isfinite\(/);
  });

  it('casts the usb.read byte via static_cast (M5-0-7 clean)', () => {
    const r = transpileZephyrStrategy(`
      import { USB0 } from '@typecad/hal';
      const b = USB0.read();
    `);
    expect(r.cpp).toMatch(/static_cast<int>\(__b\)/);
    expect(r.cpp).not.toMatch(/\(int\)__b/);
  });
});
