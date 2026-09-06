---
'@typecad/cuttlefish': patch
---

Test-infra race fix — `transpile()` helper uses a per-call unique output directory for every target.

Root cause of the intermittent "expected '' to contain …" e2e flakes: the shared `.build/tests` directory was written to AND cleaned up (unlink of src.cpp/src.h) by every test across parallel vitest workers, so a worker could read a half-deleted or just-replaced output file. Arduino targets already used per-call subdirs (for .ino naming); all targets do now. The compliance sidecar test was adapted to scan the tree for its newly-created deviation file instead of flat-listing the old shared dir.

Three consecutive full-workspace runs green (3189 tests); the previously intermittent 1–2-file empty-cpp failures are gone.


Follow-up in the same infra area: the pin-state-tracking *producers* were cut (`notePinWrite/Toggle/AnalogOutput` calls in the HAL resolver) — the pin-levels map is now permanently empty, making every downstream consumer (control-flow snapshots, shadow-var declaration emission, `resolveTrackedRead`) a structural no-op. The legacy output-read folding semantics are dead; the inert module file and its no-op consumers remain as scaffold for physical deletion later.
