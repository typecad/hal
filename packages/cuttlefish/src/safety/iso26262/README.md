# `@typecad/safety/iso26262`

Reserved subpath for ISO 26262-specific functionality:

- **Part B** — Part 6 software-rule checker (IR-walking analyzer). Will add
  `analyzeIR(program): Diagnostic[]` to `TranspilerSafetyHook`.
- **Part C** — Safety-artifact sidecar emitter. Will add
  `collectSafetyMetadata(program): SafetyMetadata[]` and a
  `renderSafetyRegistryJson()` modeled on cuttlefish's AUTOSAR
  `renderRegistryJson`.

See `docs/superpowers/specs/2026-07-27-safety-package-part-a-design.md`.
