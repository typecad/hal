---
'@typecad/cuttlefish': patch
---

## Safety wrappers no longer promote their `let`s to `const`

The constness analysis treated `SafeVariable`/`SafeInt` method calls
(`.set(...)`, `.add(5).mul(2)`) as non-mutating, so a safety-typed `let` was
promoted to `const` and the emitted C++ failed to compile (the wrapper's
members mutate only through those methods, by design). Mutation is now
matched on the chain's leading identifier and gated on the receiver's
declared safety cppType, so unrelated user classes with same-named methods
(`set`, `add`, …) are untouched. Guarded by a new end-to-end test that runs
the real transpile pipeline and compiles the emitted C++ with a host g++.
