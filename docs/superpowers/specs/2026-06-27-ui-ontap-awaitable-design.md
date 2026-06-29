# `ui.onTap()` — awaitable tap notifications

**Date:** 2026-06-27
**Status:** Approved (Sections 1–6)
**Scope:** Core feature — no demo-ui user code.

## Problem

Cuttlefish supports reactive UI bindings and synchronous per-element callbacks
(`screen.btn.onClick(cb)` → function-pointer table dispatched from
`ui_touch_up`). It also supports real async/await (`await delay(ms)` lowers to
a cooperative state machine over a microtask runtime).

What's missing is an **awaitable tap event**: there is no way to write
`await <something>` that resumes on a touch. This blocks the two use cases the
user named — turning the display off after a period of inactivity
(screensaver / display-sleep) and custom-element flows like "tap to continue".

## Decision summary (from brainstorming)

- **API shape:** global awaitable `ui.onTap()` + per-element overload
  `ui.onTap(node)`. Mirrors `ui.watchPin`. (Chosen over per-element-only and
  over a sync callback.)
- **Interaction with `onClick`:** both fire. A tap runs the element's onClick
  handler AND resumes any `await ui.onTap()` awaiter.
- **Demo:** core feature only, no demo-ui user code added.
- **Approach:** A — runtime tap counter + a 3rd async poll kind in
  `async-state-machine.ts`, reusing the existing `__EMIT__`-marker idiom.

## API

```ts
export declare function onTap(node?: unknown): Promise<void>;
export const ui = { mount, signal, bind, watchPin, bindList, onTap };
```

- `await ui.onTap()` — resume on the next tap **anywhere** (including empty
  screen space; this is what makes display-sleep "wake on any touch" work).
- `await ui.onTap(screen.btn)` — resume only when that element is tapped.

`await` is statement-level only in cuttlefish (the IR has no assignment-from-
await), so `onTap` is a void resume — it returns `Promise<void>` and does not
yield the tapped element. Taps elsewhere are ignored by a per-element
awaiter but still fire onClick and still satisfy any global awaiter.

## Data flow

```
Authoring:     async function f() { await ui.onTap(screen.btn); … }
Resolver:      method==="onTap" → resolveOnTapCall
                 arg-less      → callee="__UI_TAP__", args=[-1]
                 screen.x node → args=[resolveNodeIndex(htmlPath,id)]
                 isAwaited: true
State machine: "__UI_TAP__" marker → 3rd poll kind (tap-counter):
                 capture _tapPrev = __ui_tap_seq;
                 advance when __ui_tap_seq != _tapPrev
                 (per-node: && __ui_tap_node == N)
Runtime:       volatile uint32_t __ui_tap_seq = 0;
               volatile int8_t   __ui_tap_node = -1;
               in ui_touch_up(), AFTER ui_dispatch(click/release):
                 __ui_tap_seq++; __ui_tap_node = clickedNode;
```

## Why this design

- **Counter + poll, not callbacks.** A polled state machine needs no waiter
  list — it re-reads `__ui_tap_seq` each tick and compares to the snapshot
  captured at await-start. Avoids dynamic memory in the hot touch path.
- **Marker callee idiom.** `async-state-machine.ts` already special-cases
  `awaitedCallee === "__EMIT__"` for pin-edge polling. `__UI_TAP__` reuses
  that exact pattern as a sibling branch — no new IR kind.
- **Both-fire is free.** The increment sits after `ui_dispatch` in
  `ui_touch_up`, so onClick always runs first; the awaiter wakes on its next
  poll. No suppression anywhere.
- **Empty-space taps count.** The bump is outside the `__ui_touch_node >= 0`
  guard, so a wake-on-any-touch works even when the finger lands on no node.
  Per-node awaiters filter via `__ui_tap_node == N` in the poll condition.

## Layers (implementation)

1. **`packages/ui/src/index.ts`** — add `onTap` declaration + include in `ui`.
2. **`packages/cuttlefish/src/ui/runtime-header.ts`** — add
   `__ui_tap_seq` / `__ui_tap_node`; bump in `ui_touch_up` after dispatch.
3. **`packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts`** —
   `resolveOnTapCall` + dispatch entry; uses `resolveNodeIndex`/
   `resolveUIModuleImport` (same helpers as onClick).
4. **`packages/cuttlefish/src/emit/utils/async-state-machine.ts`** — detect
   `__UI_TAP__` marker, emit tap-counter poll (setup captures snapshot, poll
   compares). No `_waitUntil`; optional node filter inlined.
5. **Preview** (`host-ui-runtime.ts`, `build-program.ts`) — `tapSeq`/`tapNode`
   fields bumped on tap; `onTap` shim returning a Promise that resolves on
   next counter bump (poll via `setImmediate`, mirroring the device tick).

## Out of scope (YAGNI)

- Returning the tapped element/value from `onTap`.
- Distinguishing tap-down vs tap-up.
- Multi-awaiter fan-out ordering guarantees (FIFO is incidental, not promised).
- Demo-ui user code.

## Testing

- Resolver: `ui.onTap()` / `ui.onTap(screen.btn)` → marker IR (`__UI_TAP__`,
  args `[-1]` or `[nodeIdx]`, `isAwaited`).
- E2E transpile: full async function emits a state machine whose poll case
  reads `__ui_tap_seq` / `__ui_tap_node`.
- Runtime-header: `__ui_tap_seq++` present in the touch-up path.
- Preview: tap drives the `onTap` Promise to resolve.
