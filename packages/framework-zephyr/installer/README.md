# Zephyr installer (bundled with @typecad/framework-zephyr)

A one-command, cross-platform installer for a working **Zephyr RTOS** build
environment, built on [micromamba](https://mamba.readthedocs.io/) and the
official Zephyr SDK. It produces an activatable environment with `west` + host
build tools, the Zephyr SDK cross-toolchains, and a vanilla Zephyr `west`
workspace — wired so [`framework-zephyr`](../framework-zephyr) finds everything
automatically.

- **No prerequisites** — no preinstalled conda, Python, or toolchain. micromamba
  is fetched as a single static binary.
- **Cross-platform** — Linux, macOS, and Windows-native (PowerShell). No WSL.
- **Just works** — the default installs every toolchain platform, so any board in
  the Zephyr data pack compiles as-is with no follow-up installs (~1.5 GB download,
  ~11 GB extracted). Space-conscious users can opt into a subset (~150-300 MB).
- **Reproducible** — SDK version, Zephyr manifest revision, and per-platform
  SHA256s are pinned in [`versions.env`](./versions.env).

## Commands

All commands work identically on Linux, macOS, and Windows (Node ≥ 18 required —
already a dependency of this repo):

```sh
npx --package @typecad/framework-zephyr zephyr-installer                        # install everything (interactive; Enter = All)
npx --package @typecad/framework-zephyr zephyr-installer --platforms arm,esp32   # space-saver: subset only
npx --package @typecad/framework-zephyr zephyr-installer --modify --yes          # later: add any missing toolchains (additive)
npx --package @typecad/framework-zephyr zephyr-installer --modify --prune --yes  # ...and also remove unselected ones
npx --package @typecad/framework-zephyr zephyr-installer --delete                # uninstall everything
npx --package @typecad/framework-zephyr zephyr-installer --help                  # full usage reference
npx --package @typecad/framework-zephyr zephyr-installer --dry-run               # preview the resolved plan
```

(From a repo checkout, `node packages/framework-zephyr/installer/install.mjs` is the same
entry point. The OS-native `bash install.sh` / `pwsh -File install.ps1` remain
usable directly for power users.)

## Flags

| Flag | Description |
| ---- | ----------- |
| *(none)* | Interactive install: platform checklist → summary → Enter → install. |
| `--platforms IDS` | Space-saving, non-interactive platform selection: comma-separated group ids (`arm,esp32,riscv,arc,rx,x86,aarch64`) or `all`. Default: `all` — recommended, so every board in the data pack builds as-is. |
| `--modify` | Re-run the SDK platform step on an existing install: **adds** the selected groups' missing toolchains (idempotent per-toolchain). Purely additive — nothing is deleted unless `--prune` is also given. SDK-only — skips the env and workspace steps. |
| `--prune` | With `--modify`: also **delete** toolchains of platforms not in the selection (reclaim disk space). |
| `--delete` | **Uninstall everything**: conda env, Zephyr SDK, west workspace, and micromamba itself (only when it has no other envs). Shows exact paths + sizes and requires typing `yes` to confirm. |
| `--yes`, `-y` | Skip confirmation prompts (CI / scripting). With `--delete` this is the only non-interactive way to proceed. |
| `--dry-run` | Print the resolved plan — URLs, paths, versions, platform selection — and exit. Downloads/creates nothing. |
| `--no-sdk` | Skip the Zephyr SDK download entirely (env + workspace only). |
| `--no-workspace` | Skip `west init`/`west update` (env + SDK only). |
| `--env-name NAME` | Override the conda env name (default: `zephyr`). |
| `--sdk-version VER` | Override the Zephyr SDK version (default: pinned in `versions.env`). |
| `-h`, `--help` | Print the full usage reference and exit. |

Short forms: `-m` = `--modify`, `-d` = `--delete`, `-y` = `--yes`.

### Environment overrides

| Variable | Default | Controls |
| -------- | ------- | -------- |
| `MAMBA_ROOT_PREFIX` | `~/micromamba` | micromamba root (binary, envs, pkgs cache) |
| `WORKSPACE_DIR` | `~/zephyrproject` | west workspace location (`ZEPHYR_BASE` is `<dir>/zephyr`) |
| `SDK_INSTALL_PARENT` | `$MAMBA_ROOT_PREFIX/zephyr-sdk` | where the SDK extracts |
| `TYPECAD_ZEPHYR_ENV` | *(unset)* | env-name override honored by the framework's west discovery |

## Platform selection

A full install downloads the 1.5 GB SDK bundle (all 25+ toolchains — hours on a
slow connection). Most users need one or two platforms. The installer instead
downloads the ~10 MB minimal bundle (cmake config + `sdk_version`) plus only the
selected toolchains:

| Group | Toolchain(s) | Covers | ~Download |
| ----- | ------------ | ------ | --------- |
| `arm` | `arm-zephyr-eabi` | nRF, RP2040, STM32, SAMD, all Cortex-M | ~150 MB |
| `esp32` | `xtensa-espressif_esp32{,s2,s3}_zephyr-elf` | ESP32, ESP32-S2, ESP32-S3 | ~300 MB |
| `riscv` | `riscv64-zephyr-elf` | ESP32-C3/C6, generic RISC-V | ~120 MB |
| `x86` | `x86_64-zephyr-elf` | native_sim, x86 boards | ~100 MB |
| `aarch64` | `aarch64-zephyr-elf` | ARM64 boards | ~100 MB |
| `all` | *(full bundle)* | everything | ~1.5 GB |

Board support beyond toolchains is universal — `west update` fetches every HAL
module (they're small), so `rp2040`, `samd`, `nrf`, `stm32`, etc. all build with
the `arm` group alone. Only ESP32 adds Python tooling (`esptool`), installed
automatically from the espressif HAL's own requirements.

The interactive checklist accepts numbers (`1 2`), group ids (`arm,esp32`), or
`all`, and marks already-installed groups:

```
Select platform toolchains to install:

  [1] ARM Cortex-M (nRF, RP2040, STM32, SAMD, ...)      ~150 MB  installed
  [2] ESP32 / ESP32-S2 / ESP32-S3 (Xtensa)              ~300 MB
  [3] RISC-V (ESP32-C3/C6, generic RISC-V)              ~120 MB
  [4] x86 / native_sim                                  ~100 MB
  [a] All (full bundle, ~1.5 GB download / ~11 GB extracted)

Enter selection (e.g. '1 2', 'arm,esp32', or 'all'):
```

The selection persists in `$SDK_INSTALL_DIR/.typecad-platforms`.

### `--modify` (reconfigure)

Re-runs the checklist with installed toolchains marked, then applies the delta:
new selections download (existing toolchains are skipped — no re-download),
deselections **delete their toolchain directories**. A warning is shown before
the checklist; re-adding a removed platform later re-downloads it. Use
`--platforms` with `--modify` to script it, e.g.
`--modify --platforms arm,riscv`.

### `--delete` (uninstall)

Shows every path that will be removed with its on-disk size, then requires
typing `yes`:

- the conda env (`$MAMBA_ROOT_PREFIX/envs/<name>`)
- the Zephyr SDK (`$MAMBA_ROOT_PREFIX/zephyr-sdk/`)
- the west workspace (`~/zephyrproject`)
- micromamba itself — **only when no other conda envs exist**; otherwise the
  root is kept and surviving envs are named

Non-interactive stdin without `--yes` **refuses** (destructive default-deny).
The shell-profile hook (from `micromamba shell init`) is never auto-edited; the
summary names the file to trim by hand.

## What an install does

1. Downloads the micromamba static binary (no preinstalled conda/Python needed)
   and registers its shell hook (`~/.bashrc` / PowerShell `$PROFILE`).
2. Creates a `zephyr` conda env from [`environment.yml`](./environment.yml)
   (python, west, cmake `<4`, ninja, gperf, pyelftools), plus platform extras:
   `dtc` + `openocd` on POSIX, `7zip` on Windows.
3. Installs activation hooks that export `ZEPHYR_BASE` + `ZEPHYR_SDK_INSTALL_DIR`.
4. Fetches + verifies + extracts the Zephyr SDK (minimal + selected toolchains,
   or the full bundle).
5. Runs `west init --mr <rev>` + `west update`, then installs Zephyr's Python
   build requirements (`requirements-base.txt` + build-relevant per-module
   requirements such as `esptool`).

No `sudo`, no Zephyr SDK `setup.sh` — the SDK is used in place via
`ZEPHYR_SDK_INSTALL_DIR`.

## Activate

The installer runs `micromamba shell init` for you, so in a **new** shell you
only need to activate the env — and `framework-zephyr` then discovers `west`
automatically:

```sh
micromamba activate zephyr

# verify
west --version
echo $ZEPHYR_BASE                 # -> ~/zephyrproject/zephyr
```

In fact, with `@typecad/framework-zephyr` ≥ alpha.11 you don't even need to
activate to **build** — typecad-hal discovers the micromamba env and invokes
`micromamba run -n zephyr west …` itself. Activation matters for your own
interactive use (`west`, `gdb`, serial monitors).

For the **current** session (without a new shell):

```sh
# bash / zsh
eval "$(micromamba shell hook --shell bash)"
micromamba activate zephyr
```

```powershell
# PowerShell — NB: the `micromamba shell hook ... | Invoke-Expression` pipe
# form does NOT work (it parses the multi-line hook line-by-line and fails).
Invoke-Expression ((& "$env:MAMBA_EXE" shell hook -s powershell) -join [char]10)
micromamba activate zephyr
```

## What lands where

| Thing            | Default location                                 | Override            |
| ---------------- | ------------------------------------------------ | ------------------- |
| micromamba root  | `~/micromamba` (`%USERPROFILE%\micromamba`)      | `MAMBA_ROOT_PREFIX` |
| conda env        | `$MAMBA_ROOT_PREFIX/envs/zephyr`                 | `--env-name`        |
| Zephyr SDK       | `$MAMBA_ROOT_PREFIX/zephyr-sdk/zephyr-sdk-<ver>` | `SDK_INSTALL_PARENT`|
| west workspace   | `~/zephyrproject`                                | `WORKSPACE_DIR`     |

The SDK lives **outside** the conda env prefix on purpose: `micromamba create`
needs the prefix empty, and a failed env-create must not trap a multi-GB
download. `micromamba env remove -n zephyr` removes the env but leaves the SDK —
delete `$MAMBA_ROOT_PREFIX/zephyr-sdk` separately to reclaim that space (or just
use `--delete`).

## How it integrates with `framework-zephyr`

`framework-zephyr` resolves `west` via a discovery cascade
([`src/toolchain/west-discover.ts`](../src/toolchain/west-discover.ts)):

1. `west` on PATH (activated shell)
2. `$ZEPHYR_BASE` venv
3. **micromamba env from this installer** — invoked via `micromamba run`, which
   sets up the full PATH + activation hooks with no manual activation
4. Well-known workspace dirs (`~/zephyrproject`, …)
5. System pythons

So a plain `npx typecad-hal build` works in any project after install, activated
or not. The compat check reads the Zephyr version from the installer env's
env-vars file when `ZEPHYR_BASE` isn't set.

### Pre-existing Zephyr install on the same machine

If you already had a west/SDK install, **activation is the switch** — the
activated env is prepended to PATH, so its `west` and the hook's
`ZEPHYR_SDK_INSTALL_DIR` win. Unactivated, typecad-hal prefers the installer env
(cascade order 3 before 4), falling back to a pre-existing `~/zephyrproject/.venv`.

## Per-project auto-activation

Drop [`templates/project/`](./templates/project) into a typecad-hal Zephyr project
so opening a terminal there auto-activates the env — machine-agnostic activators
(`.typecad/activate-zephyr.{ps1,sh}`) plus a VS Code terminal profile. See
[`templates/project/README.md`](./templates/project/README.md).

## Customizing

All version + URL pinning lives in [`versions.env`](./versions.env):

- `ZEPHYR_SDK_VERSION` — currently **1.0.1** (the Zephyr 4.4-compatible line;
  1.0.x dropped "full" bundles — `_gnu` = all GNU toolchains + host tools).
  Building against Zephyr 4.3.x instead? Use `--sdk-version 0.17.4`.
- `ZEPHYR_SDK_BUNDLE_SUFFIX` — the bundle flavor (`_gnu` on 1.0.x, empty on
  0.17.x). Individual toolchain tarballs carry it as an infix
  (`toolchain_gnu_<plat>_<target>`).
- `ZEPHYR_MANIFEST_REV` — bump and re-run to upgrade. Re-running re-pins the
  manifest revision on an existing workspace (`west config manifest.revision`),
  so a workspace adopted from a pre-existing install — or one tracking `main` —
  converges onto the pinned tag instead of drifting out of sync with the SDK.
- `SHA256_<platform>` — per-platform bundle hashes from the release's official
  `sha256.sum`. `TODO` = not yet pinned (the installer prints the computed hash
  on first download for you to pin); `NONE` = no build exists for that platform
  (**macOS Intel has no 1.0.x SDK** — the installer fails with guidance there).
- `PLATFORM_<group>` — the platform-group → toolchain mapping behind the
  checklist and `--platforms`.

`--env-name` / `--sdk-version` override ad-hoc without editing the file.

## Platform-specific tools

`environment.yml` lists only packages available on conda-forge for *every*
platform (micromamba's solver ignores `# [not win]` selectors). Platform-limited
tools are added by the install scripts in a follow-up `micromamba install`:

| Tool                             | Source                        | Platforms                                  |
| -------------------------------- | ----------------------------- | ------------------------------------------ |
| `dtc` (device tree compiler)     | conda-forge via `install.sh`  | linux-64, linux-aarch64, osx-64, osx-arm64 |
| `openocd` (JTAG/SWD flash+debug) | conda-forge via `install.sh`  | linux-64, osx-64 only (no arm64, no win)   |
| `7zip` (extract the `.7z` SDK)   | conda-forge via `install.ps1` | win-64                                     |
| `dfu-util` (USB DFU flashing)    | MSYS2 mingw64 via `install.ps1` (pinned in `versions.env`); system package manager hint on POSIX | win-64 (installed into the env); POSIX prints the install command |
| `bossac` (SAMD SAM-BA flashing)  | official BOSSA MSI via `install.ps1` (pinned in `versions.env`); system package manager hint on POSIX | win-64 (installed into the env); POSIX prints the install command |

**Windows `dtc`** — conda-forge has no win-64 build and the SDK bundle ships no
standalone `dtc` binary there. This rarely blocks builds (Zephyr's Python
`edtlib` does the devicetree work); if a board needs the C `dtc`, install it via
chocolatey (`choco install dtc`) or the SDK's `setup.cmd`.

## Troubleshooting

- **`npx --package @typecad/framework-zephyr zephyr-installer` does nothing** — fixed in alpha.11 (the
  entry-point guard now follows symlinks). If on an older alpha, run
  `node node_modules/@typecad/framework-zephyr/installer/install.mjs` directly.
- **`west: command not recognized` / empty `ZEPHYR_BASE`** — the env isn't
  activated in *this* session. Run `micromamba activate zephyr`. Note that
  `typecad-hal build` works without activation (see integration above).
- **`micromamba: command not found`** in a new shell — the installer ran
  `micromamba shell init`; reload with `. $PROFILE` (PowerShell) or
  `source ~/.bashrc`, or open a new terminal.
- **PowerShell: `micromamba shell hook ... | Invoke-Expression` fails** — that
  pipe form parses the multi-line hook line-by-line and breaks. Use the
  array-join form shown in [Activate](#activate).
- **`env: '…\envs\zephyr' exists but is not a valid conda env (no conda-meta)`**
  — residue from a prior failed run. Remove it and re-run.
- **`west update` → `MalformedConfig: local configuration file not found`** —
  a broken `.west/`; the installer now re-initializes it automatically (alpha.11).
- **CMake error at `FindZephyr-sdk.cmake` (`Unknown arguments specified`)** —
  cmake 4.x vs Zephyr 4.3.x; the env pins `cmake<4` (alpha.11). On an env
  created before that pin: `micromamba install -n zephyr 'cmake>=3.20,<4'`.
- **ESP32 build: `esptool: error: unrecognized arguments`** — missing esptool
  in the env; fixed by the per-module requirements step (alpha.11). Retroactively:
  `pip install -r ~/zephyrproject/modules/hal/espressif/zephyr/requirements.txt`
  (with the env's python).
- **Windows C++ compile: `bits/c++config.h: No such file or directory`** —
  Windows MAX_PATH (260) exceeded by a deeply nested SDK path. Keep the SDK path
  short (junction a shallow path to it and point `ZEPHYR_SDK_INSTALL_DIR` at the
  junction), then wipe the build dir so CMake re-configures with the new path.
- **`warning libmamba Windows version found:10.0.<build> - Not setting long
  path registry key…`** — a known micromamba bug misreading modern Windows 11
  builds. Cosmetic on machines with long paths enabled; check with
  `(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled).LongPathsEnabled`.
- **Linux: flashing requires root / udev rules** — install the upstream udev
  rules once (the SDK `setup.sh` that installs them is deliberately skipped);
  see the [Zephyr Linux setup docs](https://docs.zephyrproject.org/latest/develop/getting_started/installation_linux.html).
- **`west update` is slow** — it clones zephyr + all manifest projects on the
  first run. Subsequent runs are incremental.

## Layout

```
packages/framework-zephyr/installer/
  install.mjs                  entry point: checklist, confirmations, --delete, dispatch
  install.sh / install.ps1     OS-native installers (POSIX / PowerShell)
  environment.yml              conda-forge host tools (cross-platform base)
  versions.env                 pinned versions, URLs, SHA256s, platform groups
  lib/
    detect-platform.sh         uname → conda + SDK platform tokens
    fetch-sdk.sh               full-bundle or minimal+toolchains download/verify/extract
    init-workspace.sh          west init --mr <rev> + west update + Python requirements
    write-activation.sh        drop activate.d/deactivate.d hooks into the env
  etc/conda/
    activate.d/zephyr.{sh,bat,ps1}    export ZEPHYR_BASE + ZEPHYR_SDK_INSTALL_DIR
    deactivate.d/zephyr.{sh,bat,ps1}  unset them
  templates/project/           per-project auto-activation template
```

Line endings are enforced LF for all POSIX-executed files via `.gitattributes`
(`*.sh`, `*.mjs`, `*.env`, `environment.yml`) — CRLF would break bash on Linux.

Tests live at `tests/packages/framework-zephyr/installer-tests/` (run via
the repo-root `npm test`).
