// ---------------------------------------------------------------------------
// Registered-callback mutation vs const promotion — a top-level `let` mutated
// only inside an out-of-band callback body (Thread.start, watchPin, ...) must
// NOT be promoted to `const`. The promote-never-reassigned-lets pass keys off
// globallyAssignedNames, which enumerates function/class bodies; callbacks
// ride in program.registeredCallbacks and were invisible to it. The emitted
// `const int` then made g++ reject the callback's assignment
// ("assignment of read-only variable") — zephyr-weather's Thread-polled
// _seed, the canonical periodic-state pattern now that JS-named timers are
// gone.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from '../../setup';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

const _strategy = new ZephyrStrategy();
const tr = (code: string) => transpile(code, { strategy: _strategy, target: 'zephyr' });

describe('ownership: registered-callback mutation', () => {
  it('keeps a top-level let non-const when a Thread.start callback assigns it', () => {
    const result = tr(`
      import { GPIO } from '@typecad/board';
      const led = new GPIO('PB5', GPIO.OUTPUT);
      let ticks: number = 0;
      const worker = new Thread(0, { stackKb: 2 });
      worker.start((): void => {
        while (true) {
          ticks = ticks + 1;
          Time.sleep(100);
        }
      });
      led.write(true);
    `);
    const declLine = result.cpp.split('\n').find(l => /\bticks\s*=\s*0;/.test(l));
    expect(declLine).toBeDefined();
    expect(declLine).not.toMatch(/\bconst\b/);
  });

  it('still promotes a let that nothing mutates (regression guard on the pass itself)', () => {
    const result = tr(`
      import { GPIO } from '@typecad/board';
      let frozen: number = 7;
      const led = new GPIO('PB5', GPIO.OUTPUT);
      led.write(frozen > 0);
    `);
    expect(result.cpp).toMatch(/const\s+\w+\s+frozen\s*=\s*7/);
  });
});
