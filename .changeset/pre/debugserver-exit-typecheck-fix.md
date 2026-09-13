---
"@typecad/framework-zephyr": patch
---

fix: `tsc -b` at the workspace root no longer fails with TS2339 (`Property 'on' does not exist on type 'ChildProcessByStdio'`) on the debug-server exit handlers after any change that rebuilds cuttlefish in the same solution pass. `@types/node` 26 types `ChildProcess.on/once` through the internal `InternalEventEmitter` base, which can fail to surface under solution-build declaration reuse; the exit subscriptions now go through a structural copy of the signature (the copy-don't-inherit prescription `@types/node` itself uses for multi-level emitters), which resolves identically in both states.
