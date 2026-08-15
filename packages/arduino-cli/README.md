# @typecad/arduino-cli

Arduino CLI environment detection for cuttlefish — verifies that `arduino-cli`
and the board cores a project targets are installed and usable before a
build or upload is attempted.

## What's inside

- **`src/index.ts`** — public exports
- **`src/probe.ts`** — environment probing (arduino-cli presence, version,
  installed cores/boards, FQBN resolution)

## Where it's used

`@typecad/framework-arduino` and `@typecad/expect` use this package to gate
compiles and uploads on a valid Arduino toolchain and to produce actionable
diagnostics when the environment is incomplete.

## License

MIT
