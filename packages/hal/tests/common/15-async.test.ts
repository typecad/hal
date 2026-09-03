import { describe, done } from '@typecad/expect';
import { Async } from '@typecad/board';

describe("Async.sleep()")
  .it("Async.sleep() is callable without crashing")
  .expect(
    (() => {
      Async.sleep(10);
      return 1;
    })
  ).toBe(1)

describe("Async.yield()")
  .it("Async.yield() is callable without crashing")
  .expect(
    (() => {
      Async.yield();
      return 1;
    })
  ).toBe(1)

describe("Async.sleepUntil()")
  .it("Async.sleepUntil() is callable with a condition")
  .expect(
    (() => {
      Async.sleepUntil(() => true, 5);
      return 1;
    })
  ).toBe(1)

describe("Async.currentTask()")
  .it("Async.currentTask() returns a value without crashing")
  .expect(
    (() => {
      Async.currentTask();
      return 1;
    })
  ).toBe(1)

done();
