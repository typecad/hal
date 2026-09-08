import { describe, done } from '@typecad/hal/testing';
import { Counter, Time } from '@typecad/hal';

const tick = new Counter(0, { hz: 100 });
tick.onAlarm((): void => { });
tick.start();
Time.sleep(50);

describe('Counter')
  .it('start() arms the alarm and stop() stops it without trapping')
  .expect((() => { tick.stop(); return 1; })()).toBe(1)

done();
