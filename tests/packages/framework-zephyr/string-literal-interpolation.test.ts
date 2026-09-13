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
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';

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

// ── HAL call interpolated into another HAL call's template ───────────────────
//
// `led.get()` inside UART0.writeLine(`led: ${led.get()}`) is lowered to C++
// text while BUILDING the IR (resolveHALExprToText) — it never becomes a
// hal-op/hal-expr IR node. The dt-spec shim therefore cannot learn its pin
// from the IR walk; without the raw-text scan sweeping the baked `string`
// payloads, the led0 spec went undeclared and west failed with
// "'__tc_dt_led0' was not declared in this scope" (zephyr-blackpill demo).

describe('hal-call interpolation into a HAL template (Zephyr dt specs)', () => {
  it('declares the __tc_dt_* spec a template-inlined gpio read references', () => {
    const g = generateBoard('xiao_ble/nrf52840'); // led0 = P0.26
    const result = transpile(
      [
        "import { GPIO, LED, UART0 } from '@typecad/hal';",
        'const led = new GPIO(LED, GPIO.OUTPUT);',
        'UART0.writeLine(`led: ${led.get()}`);',
        '',
      ].join('\n'),
      {
        strategy: _strategy,
        boardConstants: new Map(Object.entries(JSON.parse(g.boardJson).constants)) as never,
        boardTs: g.boardTs,
        platformContext: { frameworkData: { buildTarget: 'xiao_ble/nrf52840' } } as never,
      },
    );
    // The read lowers through the board's led0 dt spec…
    expectCppContains(result, ['gpio_pin_get_dt(&__tc_dt_led0)']);
    // …and the spec declaration is emitted for it — the spec name inside the
    // baked __EMIT__ text is the only signal the shim has.
    expect(result.cpp).toContain('#ifndef __TC_DT_LED0_SPEC');
    expect(result.cpp).toContain(
      'static const struct gpio_dt_spec __tc_dt_led0 = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);',
    );
  });
});
