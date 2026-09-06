---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

## Generic/native debug codegen that compiles, plus openocd reset policy

- **The printf rewrite.** The generic/native `--debug` codegen used to inject
  raw `std::cout << ...` text as "TypeScript"; the parser read `std::cout` as
  a label and the emitted C++ was `std: :` noise that could never compile.
  Every injected line now rides the `rawCpp()` passthrough (the call lowers to
  `__EMIT__` and its string argument is emitted verbatim), so the generator
  can author arbitrary C++ — printf with `static_cast`s, a getchar-based
  halt, and the static skip flag — without the TS parser ever seeing it.
  `printf`/`getchar` pull in `<cstdio>` on demand (program-analysis marks
  `usesCstdio` from `__EMIT__` string arguments). Press `s` + Enter at a
  breakpoint halt to skip it from then on; any other key (or EOF) re-arms it.
- **The debug dialect follows the emitting strategy.** The preprocessor used
  to pick its codegen from the global loaded-framework registry, which could
  emit Zephyr `printk` lines into a native build. The strategy that will EMIT
  the file now decides the dialect; strategies without their own debug
  codegen (NativeStrategy) fall back to the generic printf generator.
- **openocd session reset policy: `reset_config none`.** The session's resets
  are core-domain by design (vector-catch halt before the flash write,
  SYSRESETREQ to boot), so they must not depend on the SRST pin. Boards like
  the WeAct Black Pill don't break NRST out at all: under the board cfg's
  `srst_only`, every `reset` asserts a pin that reaches nothing while the
  probe's floating SRST sense reports phantom "external reset detected"
  events. Method-declared west quirks (`--cmd-pre-init=…`) are appended after
  and override the default, in the same position west gives them (after the
  cfg, before `init`).
- **`--port` is required only where it is consumed.** `uploadRequiresPort`
  gates on the resolved runner — esptool and bossac are the only runners that
  cannot flash without a serial port, so probe runners (openocd, jlink) and
  USB flows (dfu-util, uf2) are no longer blocked by a missing `--port`.
