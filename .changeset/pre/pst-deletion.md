---
'@typecad/cuttlefish': major
---

**pin-state-tracking deleted.** The last Phase-2 ledger item: `packages/cuttlefish/src/ir/pin-state-tracking.ts` (the legacy output-read shadow-variable subsystem) is physically removed, along with all seven consumer integrations:

- `hal-plugins.ts` — the four producer calls (`notePinSetMode/Toggle/Write/AnalogOutput`) were cut first; the pin-levels map has been permanently empty since.
- `route-hal-op.ts` — the `gpio.read trackedValue` fold, the `gpio.toggle updatesShadow` read-modify-write rewrite, and the `gpio.write updatesShadow` shadow-update rewrite are gone; every `gpio.*` op now lowers straight through the strategy in all cases.
- `build-ir.ts` — the `markShadowUpdatingOps`/`takeShadowDeclarations` file-scope bool declaration block and per-build reset removed.
- `control-flow.ts` — branch boundary `snapshotPinLevels`/`restorePinLevels`/`mergePinLevels` calls removed (they were no-ops on an empty map).
- `statement-to-ir.ts` / `expression-to-ir.ts` / `hal-emitter.ts` — folding gates (`isPinFoldingEnabled`/`setPinFoldingEnabled`) and the orphaned `resolveTrackedRead` fallback removed.

Behavior is unchanged by construction: the map was already empty, so every consumer was a structural no-op at deletion time. The GpioOp optional fields (`trackedValue`, `updatesShadow`) are gone from the op IR.

Known flake unchanged (pre-dates this change, passes standalone): hal-expect-blackpill cold-start intermittent failure under full parallel runs.
