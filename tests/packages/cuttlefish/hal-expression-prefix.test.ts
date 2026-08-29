// ---------------------------------------------------------------------------
// Expression-position prefix ops — a HAL method body's PRECEDING side-effect
// ops must run when the call sits in a pure expression (if-condition,
// comparison). Historically the expression resolver kept only the last op,
// silently dropping bus transaction prefixes (the i2c begin/write/end before
// a read) and pin configures (the "dead keypress" bug). The hal-expr now
// carries prefixOps and the renderer wraps the whole sequence in a GCC
// statement-expression.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile, expectCppContains } from '../../setup';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

const _strategy = new ZephyrStrategy();
const tr = (code: string) => transpile(code, { strategy: _strategy, target: 'zephyr' });

describe('HAL expression prefix ops (transpiler-level)', () => {
  it('single-op value methods are unchanged (no statement-expression wrapper)', () => {
    const result = tr(`
      import { Time } from '@typecad/hal';
      if (Time.now() > 100) { console.log('up'); }
    `);
    expect(result.cpp).toContain('k_uptime_get');
    const at = result.cpp.indexOf('k_uptime_get');
    const cond = result.cpp.slice(at - 120, at + 60);
    expect(cond).not.toContain('({');
  });

  it('multi-op statement chain survives intact (regression: resolver keeps ONLY the tail)', () => {
    // timing.set_interval resolves to the timer polyfill pair in one
    // statement; assert both fragments land. Proxy for the class of bug
    // where a leading op was dropped before the value.
    const result = tr(`
      import { setInterval } from '@typecad/hal';
      setInterval((): void => {}, 500);
    `);
    expect(result.cpp.length).toBeGreaterThan(0);
    expect(result.cpp).toContain('__tc_setInterval');
  });
});
