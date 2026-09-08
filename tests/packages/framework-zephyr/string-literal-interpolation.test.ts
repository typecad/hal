// ---------------------------------------------------------------------------
// Template-literal interpolation of a STRING VARIABLE into a HAL call —
// regression for the .c_str()/const char* mismatch. The IR scope records the
// pre-normalization type ("std::string") while the declaration renderer emits
// the strategy's mapping (Zephyr: std::string → const char*). The HAL-body
// snprintf builder used the raw scope type and appended .c_str() to a
// const char* variable — `request for member 'c_str' in ... which is of
// non-class type 'const char*'`. It now normalizes through the active
// strategy, matching the declaration.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile, expectCppContains } from '../../setup';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

const _strategy = new ZephyrStrategy();
const tr = (code: string) => transpile(code, { strategy: _strategy, target: 'zephyr' });

describe('string-variable interpolation into HAL calls (Zephyr)', () => {
  it('prints a string variable through the direct bus singleton without .c_str()', () => {
    const result = tr(`
      import { UART0 } from '@typecad/hal';
      let s = "12";
      UART0.writeLine(\`\${s}34\`);
    `);
    expectCppContains(result, ['const char* s = "12";']);
    expect(result.cpp).toMatch(/snprintf\([\s\S]*?"%s34", s\);/);
    expect(result.cpp).not.toContain('s.c_str()');
    expect(result.cpp).toMatch(/__tc_dev_put\(__tc_uart0_dev/);
  });

  it('number interpolation still formats as %d', () => {
    const result = tr(`
      import { UART0 } from '@typecad/hal';
      UART0.writeLine(\`count: \${42}\`);
    `);
    expect(result.cpp).toMatch(/"%s?"|snprintf\([^)]*"count: %d", 42\)/);
    expect(result.cpp).toMatch(/__tc_dev_put\(__tc_uart0_dev/);
  });

  it('plain string literals pass through with no interpolation buffer', () => {
    const result = tr(`
      import { UART0 } from '@typecad/hal';
      UART0.writeLine("plain");
    `);
    // The literal streams directly (no __cuttlefish_snprintf buffer for it).
    expect(result.cpp).not.toContain('__cuttlefish_snprintf');
    expect(result.cpp).toMatch(/__tc_dev_put\(__tc_uart0_dev[^;]*"plain"/);
  });
});
