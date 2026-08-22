---
"@typecad/framework-zephyr": minor
---

## Activation-free builds: discover the @typecad/zephyr-installer micromamba env

`cuttlefish build` no longer requires `micromamba activate zephyr` first. The
west discovery cascade gains a new strategy that finds the micromamba env created
by `@typecad/zephyr-installer` (via `$MAMBA_ROOT_PREFIX/envs/<name>` or
`~/micromamba/envs/zephyr`), and `westSpawn` invokes west through
`micromamba run -n <env> west …`. That sets up the env's full PATH
(cmake/ninja/dtc) AND runs the activation hook (`ZEPHYR_BASE` /
`ZEPHYR_SDK_INSTALL_DIR`), so a fresh `cuttlefish build` works in any project —
new or existing — with the user never activating.

Cascade order is now: PATH → `$ZEPHYR_BASE` → **micromamba env** → well-known
venvs → system python. The installer env is the managed default when nothing is
activated; an activated env (PATH) or explicit `$ZEPHYR_BASE` still takes
precedence. Discovery is file-check based (no spawn) so it adds no per-build
latency. Env name defaults to `zephyr` (`TYPECAD_ZEPHYR_ENV` override).

This composes with the per-project auto-activation template
(`packages/zephyr-installer/templates/project/`) for the user's interactive
shell: builds need no activation; the shell can still be wired via the template
for `west`/`gdb`/serial use.
