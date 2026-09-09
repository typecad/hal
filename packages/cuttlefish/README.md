# `@typecad/cuttlefish`

The transpiler engine inside [typeCAD/hal](https://typecad.dev).

You rarely install or invoke this package directly — it is the machinery
behind the product: `@typecad/hal` depends on it, and the `typecad-hal` CLI
forwards to it.

## What it does

- Turns TypeScript firmware into clean, zero-cost C++ — for Zephyr RTOS
  boards and desktop native targets from one codebase.
- Generates the wiring for your specific board from the Zephyr board
  catalog: typed pins, pre-built bus instances, and only the hardware your
  board actually has.
- Drives the whole toolchain through one CLI — transpile, compile, flash,
  serial monitor, hardware tests, and the Zephyr SDK installer.
- Carries the built-ins: the on-board test runner (`typecad-hal test`) and
  the desktop simulator (`npm run simulate`).

## Start here

```bash
npx @typecad/hal create my-firmware
```

- [typeCAD](https://typecad.dev) — documentation and guides
- [`@typecad/hal`](https://www.npmjs.com/package/@typecad/hal) — the product

## License

Apache-2.0
