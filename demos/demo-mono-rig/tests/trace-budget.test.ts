// In-DSL trace assertions: the gate is evaluated host-side over the trace
// heartbeats that closed inside this it() — the dwell (4.5s ~ 2x the trace
// interval + margin) keeps the window populated. Requires the firmware to
// be built with zephyr.trace.enabled (this demo's config has it).
import { describe, done } from '@typecad/hal/testing';

describe('trace budgets')
  .it('mostly idle while dwelling')
    .expect(1).toBe(1)
    .trace('cpu-avg:idle>=50', 4500)
    .trace('cpu-avg:main<=50', 0);

done();
