---
"@typecad/zephyr-installer": minor
---

## `--delete`: uninstall everything after explicit confirmation

```sh
npx @typecad/zephyr-installer --delete    # shows what will be removed, asks 'yes'
```

Removes everything the installer created:

- the conda env (`$MAMBA_ROOT_PREFIX/envs/<name>`)
- the Zephyr SDK (`$MAMBA_ROOT_PREFIX/zephyr-sdk/`)
- the west workspace (`~/zephyrproject`)
- micromamba itself (`$MAMBA_ROOT_PREFIX`) — **only when no other conda envs
  exist**; otherwise the root is kept and the other envs are named in the summary

Safety model (destructive ops default-deny):

- Shows the exact paths **with on-disk sizes** before anything is touched.
- Requires typing `yes` exactly (Enter/cancel aborts with nothing deleted).
- Non-interactive stdin without `--yes` **refuses** (unlike install/modify,
  which proceed) — `--delete --yes` is the explicit scripting form.
- The shell-profile hook from `micromamba shell init` is deliberately NOT
  edited automatically; the summary names the file to trim by hand.
- Per-item results report `deleted`/`skipped` (locked files skip with the OS
  error instead of aborting the rest).
