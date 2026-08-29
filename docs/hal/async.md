# Async (Cooperative Multitasking)

TypeCAD lowers `async`/`await` to **cooperative state machines** — no RTOS task per async function, no heap, no dynamic allocation. Each async body becomes a small task class whose `run()` advances one step per driver-loop tick; `await` points become states that resume on a deadline, a poll condition, or an event.

This is the one place the HAL's "every call blocks" model softens: inside an async function, the long waits (`Time.sleep`, network ops) yield to everything else sharing the loop.

---

## Free async functions → tasks

An `async function` becomes a task that **auto-starts**: the first `run()` pump enters its initial state whether or not you called the function. Calling it at top level is optional documentation of intent:

```typescript
import { WiFi, Time } from '@typecad/hal';

const wifi = new WiFi('HomeNet', { psk: 'hunter22' });

async function network() {
  wifi.joinStart();
  while (!wifi.linked()) { await Time.sleep(100); }
  console.log(wifi.ip());
}

async function heartbeat() {
  while (true) {
    console.log('beat');
    await Time.sleep(500);
  }
}

network();      // optional — tasks auto-start on the first loop pump
heartbeat();
```

Both tasks share the driver loop: the heartbeat keeps beating while the station associates.

### How a body is split

The generator splits the body at each `await` into segments; each segment's statements run, then the await that ended it is *armed*:

| `await` on | Resume when |
| :--- | :--- |
| `Time.sleep(ms)` | the deadline passes (millis polling) |
| `wifi.join()` / `wifi.scan()` | start + poll — the op's start runs, a condition is polled each tick |
| `req.send()` (`Request`) | send-start + done poll |
| `ui.onTap()` | the next tap (optionally on a specific UI node) |
| `Async.sleep(ms)` | the deadline passes (the timer-shaped form) |

HAL-op chains before the await (`new Request(...).header(...)` statements) lower as the same segment's leading statements — construction facts flow into the split naturally.

---

## Async methods on classes

An `async` **method** lowers to an *owner-bound* task: the task holds a pointer to the receiver, and `this.field` inside the body reads/writes that instance's field.

```typescript
import { Time, GPIO } from '@typecad/hal';

class Blinker {
  count: number = 0;
  async run(): Promise<void> {
    while (true) {
      this.count = this.count + 1;      // → _owner->count in the task
      await Time.sleep(100);
    }
  }
}

const b = new Blinker();
b.run();            // or: void b.run();  — binds b and arms the machine
```

- **Calling the method is what starts it** (free functions auto-start; methods need the receiver). Both `b.run();` and `void b.run();` work.
- **Calling it again rebinds and restarts** — one task slot per method, mirroring the free-function tasks. For per-instance concurrency, give each instance its own method or hoist to a free function taking the instance.
- Constraints (build errors, not silent wrong code): the method must be **parameterless**, **non-static**, and return **`void`/`Promise<void>`**. Parameters can't be captured by the static machine; static methods have no receiver.

---

## What you can't await — and how you find out

Awaiting anything without a cooperative lowering used to silently drop the call and arm a zero-millisecond wait. It's now a **build error** (`await-unsupported-call`) naming the callee. The awaitable set: `Time.sleep`, the HAL splits above (`wifi.join`, `wifi.scan`, `Request.send`), `ui.onTap()`, and the timer-shaped `Async.sleep`.

Two related rules:

- **Statement position.** `await req.send();` splits; `const ok = await req.send();` cannot suspend mid-expression and falls back to the *blocking* form. Keep awaited calls on their own statement.
- **Awaiting another task's completion is not supported** — there is no completion propagation between tasks. Poll shared state instead (`while (!mqtt.linked()) { await Time.sleep(50); }`).

---

## Timers and `Async`

Outside `async` functions, two scheduling surfaces ride the same cooperative runtime:

```typescript
import { setInterval, setTimeout, Async } from '@typecad/hal';

setInterval(() => console.log('tick'), 1000);   // periodic, cooperative
setTimeout(() => console.log('once'), 250);     // one-shot

Async.sleep(20);        // arm a one-shot timer (fire-and-forget scheduling)
Async.yield();          // defer one pump cycle
```

`Async.sleep` inside an async function is awaitable (`await Async.sleep(ms)` is the timer-shaped deadline wait). Timers allocate from a fixed slot pool (8 by default) — beyond that, `armTimeout` returns false and the timer silently doesn't fire, so keep concurrent timers bounded.

---

## The mental model

- One thread of execution; every task gets a slice of each driver-loop tick.
- A task between awaits runs to its next await — keep segments short if latency matters elsewhere.
- Everything the HAL blocks on at top level (joins, sends, scans) has a start/poll split inside async — that's the point of the tier.
- The generated `Task` classes are static C++: no heap, no vtables per task, fixed state enums. `isComplete()` tells you when a linear task finished; cyclic tasks never do.
