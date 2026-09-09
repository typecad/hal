# `@typecad/framework-zephyr`

The Zephyr engine behind your [typeCAD/hal](https://typecad.dev) builds.

When you scaffold a firmware project with `npx @typecad/hal create` and pick
a board, this is the package that lands in your dependencies and does the
heavy lifting: your TypeScript compiles to **real Zephyr RTOS applications**,
built and flashed with Zephyr's own toolchain.

## Why

Zephyr is a production-grade RTOS — but its devicetree, Kconfig, and CMake
layers demand real effort before your first blink. This package moves that
effort into the toolchain: you write TypeScript against `@typecad/hal`, and
the generated firmware calls the native Zephyr driver APIs directly. No
boilerplate project, no devicetree hand-editing, no Arduino compatibility
shims — just the RTOS, driven by code you can read.

## What it does for you

- **Generates a complete Zephyr application** from your firmware — entry
  point, devicetree overlays, and Kconfig — regenerated automatically
  whenever your code changes.
- **Builds and flashes through Zephyr's `west` toolchain**, discovering
  your environment without activation scripts (works from any terminal).
- **Knows your board.** Board definitions come from your Zephyr tree's
  catalog — 1,300+ board variants, same workflow for every one.
- **Debugs on hardware.** Set breakpoints in your TypeScript in VS Code and
  debug the running board (the TypeCAD Debug extension ships into every
  project).
- **Installs the toolchain for you.** No Zephyr SDK yet? One command:

  ```sh
  npx --package @typecad/framework-zephyr zephyr-installer
  ```

## Start here

```bash
npx @typecad/hal create my-firmware   # pick a board — this framework is the default
cd my-firmware && npm run upload
```

- [typeCAD](https://typecad.dev) — documentation and guides
- [`@typecad/hal`](https://www.npmjs.com/package/@typecad/hal) — the product

## License

Apache-2.0
