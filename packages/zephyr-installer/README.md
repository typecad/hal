# @typecad/zephyr-installer

A one-command, cross-platform installer for a working **Zephyr RTOS** build
environment, built on [micromamba](https://mamba.readthedocs.io/) and the
official Zephyr SDK. It produces an activatable environment with `west` + host
build tools, the Zephyr cross-toolchains, and a vanilla Zephyr `west` workspace —
wired so [`framework-zephyr`](../framework-zephyr) finds everything
automatically once the env is activated.

- **No prerequisites on the host** — no preinstalled conda, Python, or toolchain.
  micromamba is fetched as a single static binary.
- **Cross-platform** — Linux, macOS, and Windows-native (PowerShell). No WSL.
- **Reproducible** — SDK version, Zephyr manifest revision, and (optionally)
  per-platform SHA256s are pinned in [`versions.env`](./versions.env).

## Quick start

```sh
# 1. Install (one command, any OS — needs Node ≥18, which this repo already requires)
node packages/zephyr-installer/install.mjs
```

That downloads micromamba, creates a `zephyr` conda env, fetches + extracts the
Zephyr SDK, and runs `west init` + `west update`. It also runs
`micromamba shell init` so `micromamba` is available in new shells.

```sh
# 2. Activate (in every new shell you build from)
micromamba activate zephyr

# 3. Verify
west --version              # -> West version: v1.5.0
echo $ZEPHYR_BASE           # -> ~/zephyrproject/zephyr (POSIX) / $env:ZEPHYR_BASE (PowerShell)
```

Then build with cuttlefish — it discovers `west` automatically:

```sh
cd <your-cuttlefish-project>
npx cuttlefish build
```

> Prefer the OS-native script directly? `bash install.sh` (POSIX) or
> `pwsh -File install.ps1` (Windows) work too. Preview the resolved plan
> without downloading anything: `node install.mjs --dry-run`.

## What lands where

| Thing            | Default location                                          | Override            |
| ---------------- | --------------------------------------------------------- | ------------------- |
| micromamba root  | `~/micromamba` (`%USERPROFILE%\micromamba`)               | `MAMBA_ROOT_PREFIX` |
| conda env        | `$MAMBA_ROOT_PREFIX/envs/zephyr`                          | `--env-name`        |
| Zephyr SDK       | `$MAMBA_ROOT_PREFIX/zephyr-sdk/zephyr-sdk-<ver>`          | `SDK_INSTALL_PARENT`|
| west workspace   | `~/zephyrproject`                                         | `WORKSPACE_DIR`     |

The SDK lives **outside** the conda env prefix on purpose: `micromamba create`
needs the prefix empty, and a failed env-create must not trap a multi-GB
download. `micromamba env remove -n zephyr` removes the env but leaves the SDK
— delete `$MAMBA_ROOT_PREFIX/zephyr-sdk` separately to reclaim that space.

Flags: `--dry-run`, `--no-sdk`, `--no-workspace`, `--env-name NAME`,
`--sdk-version VER`.

## How it integrates with `framework-zephyr`

`framework-zephyr` resolves `west` via a 4-strategy discovery cascade
([`west-discover.ts`](../framework-zephyr/src/toolchain/west-discover.ts)):

1. `west` on PATH ← **activation gives you this**
2. `$ZEPHYR_BASE/.venv`
3. Well-known workspace dirs (`~/zephyrproject`, …)
4. System pythons

When the env is activated, `west` is on PATH and `ZEPHYR_BASE` is exported, so
**Strategy 1 wins** and returns the correct SDK root. No `framework-zephyr`
code changes are required. The activation hook
([`etc/conda/activate.d/zephyr.sh`](./etc/conda/activate.d/zephyr.sh)) sources a
resolved `env-vars.*` file and exports the two vars Zephyr's CMake + west
discovery need: `ZEPHYR_BASE` and `ZEPHYR_SDK_INSTALL_DIR`.

### Pre-existing Zephyr install on the same machine

If you already had a west/SDK install, **activation is the switch** — the
activated env is prepended to PATH, so its `west` and the hook's
`ZEPHYR_SDK_INSTALL_DIR` win. Without activation, `framework-zephyr` falls back
to the other strategies and may find the old install.

## Per-project auto-activation

Drop [`templates/project/`](./templates/project) into a cuttlefish Zephyr
project so opening a terminal there auto-activates the env — no per-session
typing. It ships machine-agnostic activators (`.typecad/activate-zephyr.{ps1,sh}`)
and a VS Code terminal profile that runs the Windows activator on every new
terminal. See [`templates/project/README.md`](./templates/project/README.md).

## Customizing

All version + URL pinning lives in [`versions.env`](./versions.env). Bump
`ZEPHYR_SDK_VERSION` or `ZEPHYR_MANIFEST_REV` there and re-run the installer;
`--env-name` / `--sdk-version` override ad-hoc without editing the file.

### Pinning the SDK SHA256

The SDK 0.17.x line ships no checksum file, so `versions.env` pins the SHA256
directly per platform. The `SHA256_*` fields default to `TODO`, which makes
[`lib/fetch-sdk.sh`](./lib/fetch-sdk.sh) skip verification with a warning and
print the computed hash after the first download:

```
fetch-sdk: WARNING — SHA256 not pinned (TODO in versions.env); skipping verification.
fetch-sdk: computed sha256 (pin this in versions.env to enforce): <hash>
```

Paste that hash into the matching `SHA256_*` field to enforce verification on
subsequent installs.

## Platform-specific tools

`environment.yml` lists only packages available on conda-forge for *every*
platform — micromamba's solver ignores `environment.yml` line selectors
(`# [not win]`), so a platform-limited package there breaks the solve elsewhere.
Platform-limited tools are added by the install scripts in a follow-up
`micromamba install`:

| Tool                             | Source                        | Platforms                                  |
| -------------------------------- | ----------------------------- | ------------------------------------------ |
| `dtc` (device tree compiler)     | conda-forge via `install.sh`  | linux-64, linux-aarch64, osx-64, osx-arm64 |
| `openocd` (JTAG/SWD flash+debug) | conda-forge via `install.sh`  | linux-64, osx-64 only (no arm64, no win)   |
| `7zip` (extract the `.7z` SDK)   | conda-forge via `install.ps1` | win-64                                     |

If a tool can't install on your platform (e.g. `openocd` on Apple Silicon), the
installer warns and continues — the env stays usable. `openocd` is only needed
for JTAG/SWD flashing; nRF boards typically flash via `nrfjprog` or `pyocd`.

**Windows `dtc`** — conda-forge has no `dtc` for win-64, and the Zephyr SDK full
bundle ships no standalone `dtc` binary on Windows. This rarely blocks builds:
modern Zephyr does its devicetree work in Python (`edtlib`). If a board does
require the C `dtc`, install it via chocolatey (`choco install dtc`) or the
Zephyr SDK's `setup.cmd`.

## Troubleshooting

- **`micromamba: command not found`** in a new shell — the installer runs
  `micromamba shell init`, which writes the hook to your shell profile. Reload
  it: `. $PROFILE` (PowerShell) or `source ~/.bashrc` (POSIX); or just open a
  new terminal window.
- **`west: command not recognized` / empty `ZEPHYR_BASE`** — the env isn't
  activated in *this* session. Run `micromamba activate zephyr`. (Activation is
  per-session; see [Per-project auto-activation](#per-project-auto-activation)
  to make it automatic.)
- **PowerShell: `micromamba shell hook ... | Invoke-Expression` fails** — that
  pipe form parses the multi-line hook line-by-line and breaks. Use the
  command-substitution form instead:
  ```powershell
  Invoke-Expression ((& "$env:MAMBA_EXE" shell hook -s powershell) -join [char]10)
  micromamba activate zephyr
  ```
  If `$env:MAMBA_EXE` is empty, substitute the full path
  `C:\<you>\micromamba\Library\bin\micromamba.exe`. The installer prints this
  form at the end of a run.
- **`env: '…\envs\zephyr' exists but is not a valid conda env (no conda-meta)`**
  — residue from a prior failed run. Remove it and re-run:
  `Remove-Item -Recurse -Force <path>` (Windows) / `rm -rf <path>` (POSIX).
- **`warning libmamba Windows version found:10.0.<build> - Not setting long
  path registry key…`** — a known micromamba bug (it claims you need the 2016
  Anniversary Update on builds that are far newer). Cosmetic. Check whether long
  paths are already enabled:
  ```powershell
  (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled).LongPathsEnabled
  ```
  If `1`, ignore the warning. If `0`/empty and you hit path-too-long errors in a
  deep env, enable it (admin):
  ```powershell
  New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
  ```
- **Windows downloads fail under `Invoke-WebRequest`** — the installer uses
  `curl.exe` (not `Invoke-WebRequest`) precisely because the .NET resolver
  can't reach `api.anaconda.org` through some proxy stacks. If you're on a
  pre-1803 Windows without `curl.exe`, that's the fallback path.
- **Linux: flashing requires root / udev rules** — host-tool udev rules aren't
  installed (the SDK's `setup.sh` is skipped to avoid `sudo`). For `west flash`
  as non-root on Linux, install the upstream udev rules once; see the
  [Zephyr Linux setup docs](https://docs.zephyrproject.org/latest/develop/getting_started/installation_linux.html).
- **`west update` is slow** — it clones zephyr + all manifest projects on the
  first run. Subsequent runs are incremental.

## Layout

```
packages/zephyr-installer/
  install.mjs                  cross-platform dispatcher (the universal entry point)
  install.sh / install.ps1     OS-native bootstraps (POSIX / PowerShell)
  environment.yml              conda-forge host tools (cross-platform base)
  versions.env                 pinned SDK version, manifest rev, URLs, SHA256s
  lib/
    detect-platform.sh         uname → conda + SDK platform tokens
    fetch-sdk.sh               download + verify + extract the SDK bundle
    init-workspace.sh          west init --mr <rev> + west update
    write-activation.sh        drop activate.d/deactivate.d hooks into the env
  etc/conda/
    activate.d/zephyr.{sh,bat,ps1}    export ZEPHYR_BASE + ZEPHYR_SDK_INSTALL_DIR
    deactivate.d/zephyr.{sh,bat,ps1}  unset them
  templates/project/           per-project auto-activation template
```

This is complementary to — not a replacement for — the
[docker-backed toolchain runtime](../../docs/superpowers/specs/2026-08-02-docker-toolchain-design.md):
conda/micromamba is the **install transport**, docker is a (future) execution
backend.

Tests live at `tests/packages/zephyr-installer/` (run via the repo-root
`npm test`, or `npm test --workspace @typecad/zephyr-installer`).
