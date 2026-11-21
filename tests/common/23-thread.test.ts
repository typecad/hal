import { describe, done } from '@typecad/hal/testing';
// Thread suite — the concurrency surface. The DSL has no async/await, so
// sequencing is verified through a shared volatile flag: the thread sets it,
// the main flow polls with a bounded wait. join() is exercised on its own
// thread (a second slot) since joining the flag thread would race the poll.
import { Thread, Time } from '@typecad/hal';

// Shared with the thread body (volatile by the ISR-shared analysis — the
// same lowering the demos rely on for cross-thread flags).
let flag = 0;

describe("Thread start + flag sequencing")
  .it("a started thread sets the shared flag within a bounded wait")
  .expect(
    (() => {
      const worker = new Thread(0, { stackKb: 2 });
      worker.start(() => {
        Time.sleep(10);
        flag = 1;
      });
      // Bounded poll: the thread must land within 2 s even under a slow
      // scheduler — returns 1 only if the flag actually flipped.
      let saw = 0;
      for (let i = 0; i < 2000; i += 1) {
        if (flag === 1) {
          saw = 1;
          break;
        }
        Time.sleep(1);
      }
      return saw;
    })
  ).toBe(1)
  .it("the thread's effect persists after the poll (no reordering)")
  .expect(
    (() => {
      return flag;
    })
  ).toBe(1)

describe("Thread join()")
  .it("join() returns after the thread body completes")
  .expect(
    (() => {
      const helper = new Thread(1, { stackKb: 2 });
      helper.start(() => {
        Time.sleep(20);
        flag = 2;
      });
      helper.join();
      // join() returned — the body's last write must be visible.
      return flag === 2 ? 1 : 0;
    })
  ).toBe(1)

describe("Thread construction variants")
  .it("default options construct (slot index only)")
  .expect(
    (() => {
      const t = new Thread(0);
      t.start(() => {
        flag = 3;
      });
      return 1;
    })
  ).toBe(1)

done();
