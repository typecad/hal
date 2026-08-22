---
"@typecad/zephyr-installer": patch
---

## Fix: `npx @typecad/zephyr-installer` did nothing (symlinked-bin guard)

The entry-point guard compared `import.meta.url` to `path.resolve(process.argv[1])`,
but `path.resolve` does NOT follow symlinks. npx (and global installs) run the bin
through a symlink (`node_modules/.bin/zephyr-installer` → `…/install.mjs`), so the
guard evaluated false and `install.mjs` exited without dispatching — `npx …` produced
no output. Running `node …/install.mjs` directly worked because that path isn't a
symlink.

Fixed by resolving symlinks on both sides (`realpathSync`) before comparing — the
canonical "is main module" check that survives symlinked bins.

Also: the confirmation gate's non-interactive path now PROCEEDS instead of aborting.
Some npx invocations don't forward a TTY for stdin; the old behavior aborted there
("Non-interactive stdin with no --yes — aborting"). It now proceeds (the user invoked
it explicitly; `--yes` remains the explicit no-prompt flag), so `npx` works whether or
not it forwards a TTY.
