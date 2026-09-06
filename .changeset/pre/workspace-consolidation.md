---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

## Workspace consolidation: safety + framework-native into cuttlefish, zephyr-installer into framework-zephyr

Three first-party packages were merged into their consumers, shrinking the
published surface from ten packages to seven.

- **`@typecad/safety` → built into `@typecad/cuttlefish`.** The engine
  (pin-mode intercept pass, ISO 26262 analysis, runtime polyfills, sidecar
  writer) now lives in cuttlefish under `src/safety/` and registers directly —
  the dynamic-import bridge and the optional peer dependency are gone. The
  authoring surface is exported as `@typecad/cuttlefish/safety`; the legacy
  `@typecad/safety` import specifier still activates safety (detection is by
  name, no module resolution). `SafeVariable`/`SafeInt`/`safe` and the ISO
  26262 sidecar are unchanged.
- **`@typecad/framework-native` → built into `@typecad/cuttlefish`.** The
  native desktop target (g++/clang++ strategy, toolchain, terminal preview)
  lives in cuttlefish under `src/frameworks/native/` and is resolved directly
  by the framework loader — configs keep `framework:
  '@typecad/framework-native'` unchanged. `cuttlefish create` for native
  targets no longer adds a separate framework dependency to scaffolded
  projects (the capability ships with cuttlefish itself).
- **`@typecad/zephyr-installer` → bundled with `@typecad/framework-zephyr`.**
  The micromamba/SDK/west installer moved to `framework-zephyr/installer/`
  with its `zephyr-installer` and `typecad-zephyr-install` bins intact. The
  one-shot invocation is now `npx --package @typecad/framework-zephyr
  zephyr-installer`; in projects that depend on framework-zephyr, plain
  `npx zephyr-installer` keeps working.

Existing projects are unaffected: all three historical config strings and
import specifiers still resolve, and the previously published packages remain
installable from the registry (frozen at their last version).
