import { describe, it, expect } from 'vitest';
import { transpile } from '../../setup';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

// End-to-end coverage for the main()-based entrypoint: Zephyr is a standard
// C main() RTOS, so top-level statements lower straight into main() — no
// Arduino setup()/loop() pair and no bridge shim defining a second main().
// Event-driven programs (async tasks, no mounted UI) get their scheduler
// loop appended INSIDE main() by the async driver machinery, since main()
// runs once (the old shape bridged a synthesized empty loop() instead).
describe('ZephyrStrategy entrypoint emission (main, no setup/loop)', () => {
  const opts = {
    strategy: new ZephyrStrategy(),
    target: 'zephyr',
    platformContext: { frameworkData: { target: 'xiao_ble' } } as any,
  };

  it('lowers top-level statements straight into int main()', () => {
    const result = transpile(`
      let count: number = 0;
      while (true) {
        count = count + 1;
      }
    `, opts);

    expect(result.cpp).toContain('int main()');
    expect(result.cpp).toContain('while (true)');
    expect(result.cpp).toContain('return 0;');
    // No Arduino-style pair, and no shim-defined bridge main().
    expect(result.cpp).not.toContain('void setup()');
    expect(result.cpp).not.toContain('void loop()');
    expect(result.cpp).not.toContain('int main(void)');
    expect(result.cpp).not.toContain('extern void setup');
    expect(result.cpp).not.toContain('extern void loop');
  });

  it('appends a self-wrapped scheduler loop to main() for async programs', () => {
    const result = transpile(`
      import { Async, delay } from '@typecad/hal';

      async function heartbeat(): Promise<void> {
        await Async.sleep(100);
      }

      heartbeat();
    `, opts);

    expect(result.cpp).toContain('int main()');
    // The driver tail: pump microtasks + advance the task state machine,
    // yielding to the kernel each iteration — inside main().
    expect(result.cpp).toContain('cuttlefish_pump_microtasks();');
    expect(result.cpp).toMatch(/for \(;;\) \{[\s\S]*cuttlefish_pump_microtasks\(\);[\s\S]*k_msleep\(1\);[\s\S]*\}/);
    // One main() definition only (a plain `int main();` forward declaration
    // may precede it — the shim must not define a bridging second one).
    expect(result.cpp.match(/int main\(\)\s*\{/g)?.length).toBe(1);
  });
});
