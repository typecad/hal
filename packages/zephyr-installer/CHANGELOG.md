# @typecad/zephyr-installer

## 1.0.0-alpha.11

### Patch Changes

- 66f04cf: ## Fix: recover from a broken `.west/` (missing config) instead of failing west update

  `init-workspace` checked only for `.west/` and skipped `west init` when present. But a
  workspace can have `.west/` without `.west/config` (interrupted/partial init), which
  makes `west update` fail:

  ```
  west.configuration.MalformedConfig: local configuration file not found
  ```

  Now requires BOTH `.west/` and `.west/config`; if `.west/` exists without its config,
  it removes the partial `.west/` and re-initializes. The cloned `zephyr/` and `modules/`
  are preserved — `west update` re-syncs them, so there's no full re-clone. Mirrored in
  `install.sh` and `install.ps1`.

- 66f04cf: ## Fix: `npx @typecad/zephyr-installer` did nothing (symlinked-bin guard)

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

## 1.0.0-alpha.10

### Patch Changes

- 63433ea: ## Pin cmake <4 (Zephyr 4.3.x is incompatible with CMake 4.x)

  Fresh installs resolved `cmake 4.4.x` (the `cmake>=3.20` constraint had no
  upper bound), and `west build` then failed at CMake configure:

  ```
  CMake Error at .../cmake/modules/FindZephyr-sdk.cmake:57 (if):
    if given arguments:
      "(" "zephyr" "STREQUAL" ")" "OR" ...
    Unknown arguments specified
  ```

  Zephyr 4.3.x's `FindZephyr-sdk.cmake` uses an **unquoted** `${ZEPHYR_TOOLCHAIN_VARIANT}`
  in an `if()`. When that variable is undefined it expands to nothing; CMake **3.x**
  treats the empty expansion leniently (as an empty string), but CMake **4.x**
  rejects it as an unknown argument. Zephyr 4.3.x predates CMake 4.x.

  `environment.yml` now constrains `cmake>=3.20,<4` so conda resolves a 3.x
  (currently 3.31.x). Loosen once a Zephyr revision that supports CMake 4.x is
  pinned in `versions.env`. Guarded by a test asserting the upper bound is present.

- 69c0f79: ## Install per-module Python requirements (esptool for ESP32, etc.)

  After `requirements-base.txt`, the installer now also installs the
  **build-relevant** module `requirements.txt` files — HAL `scripts/`/`zephyr/`
  dirs (esptool for espressif, vendor flash/script tools for atmel/stm32/silabs/
  etc.) and top-level lib codegen (nanopb, zcbor). It deliberately does NOT do a
  recursive find of every `requirements.txt`, which would also pull
  docs/test/harness/example requirements (mbedtls docs, openthread test harness,
  cmsis tests, lvgl docs, tf-m tools) — heavy and conflict-prone.

  Without this, board-specific tooling was missing from the env. For ESP32 the
  post-link image step ran a stale **system** `esptool` (the env had none) which
  rejected Zephyr's invocation:

  ```
  esptool: error: unrecognized arguments: --flash-mode --flash-freq 80m --flash-size 8MB
  ```

  The espressif HAL pins `esptool>=5.0.2` in its own `requirements.txt`; installing
  the per-module requirements puts a matching `esptool` (5.x) in the env, where the
  activated `Scripts/` shadows the system one. Each module requirements file is
  installed warn-and-continue so one bad pin can't abort the whole install.

  Board support itself is universal — `west update` fetches every module and the
  SDK full bundle ships every cross-toolchain (arm, riscv, xtensa, …) — so rp2040,
  samd, nrf, stm32, etc. build with just the base env; only a few modules add
  Python tools (esptool), which this step covers.

  Mirrored in `install.sh` and `install.ps1`; guarded by a regression test
  asserting both target `modules/hal/` (not a recursive find).

- 3aaec5f: ## Pin SHA256 for the linux-x86_64 + windows-x86_64 SDK bundles

  `versions.env` shipped with every `SHA256_*` set to `TODO`, so `fetch-sdk`
  skipped verification with a warning. Pinned the two bundles exercised by real
  installs (each computed by the installer against the official Zephyr SDK 0.17.4
  release bundle):

  - `linux-x86_64`: `83f2f327…3d1116b6`
  - `windows-x86_64`: `51d550eb…d9384ecd`

  Verification is now enforced on those platforms — a mismatch aborts the install
  instead of continuing. The other three (`linux-aarch64`, `macos-x86_64`,
  `macos-aarch64`) remain `TODO` until a real install on each platform computes
  and pins them (the installer prints the computed hash on first download).

  Also adds a regression test that locks the two pinned values so a typo or
  accidental `TODO`-reset in `versions.env` is caught.

- e540f4e: ## Install Zephyr's Python build requirements into the env

  After `west update`, the installer now runs
  `pip install -r $ZEPHYR_BASE/scripts/requirements-base.txt` into the `zephyr`
  conda env. Without this, `west build` failed at CMake configure:

  ```
  CMake Error at .../zephyr_module.cmake:73 (message):
    Missing jsonschema dependency
  ```

  `environment.yml` only carried `pyelftools` + `packaging`; Zephyr additionally
  requires `jsonschema`, `pykwalify`, `PyYAML`, `intelhex`, `canopen`, `patool`,
  `psutil`, `pyserial`, `requests`, `semver`, `tqdm`, `reuse`, `anytree`, and
  `windows-curses` (Windows). Letting Zephyr's own pinned requirements file drive
  the install tracks the Zephyr revision and avoids maintaining a separate list
  that goes stale or misses deps.

  Mirrored in `install.sh` (POSIX) and `install.ps1` (Windows), fail-fast on a
  pip failure. Guarded by a regression test asserting both scripts wire
  `requirements-base.txt`.

## 1.0.0-alpha.9

### Patch Changes

- 88414b0: ## Fix: SDK download aborted on POSIX (write-activation heredoc bug)

  On Linux/macOS the installer aborted right after conda-env creation, before the
  Zephyr SDK downloaded:

  ```
  lib/write-activation.sh: line 58: env: unbound variable
  ```

  `write-activation.sh` built `env-vars.ps1` with an **unquoted** bash heredoc and
  used backticks to "escape" `$env:` — but in an unquoted heredoc a backtick is
  **command substitution**, not an escape. The resulting `` `$env:…` `` ran as a
  command, expanded the unbound `env` under `set -u`, and (with `set -e`) aborted
  the whole install. Both `` `$env `` lines fired, both attributed to the
  heredoc's start line (58).

  This only triggered on POSIX, where `install.sh` runs: Windows uses
  `install.ps1`, which writes `env-vars.ps1` via a PowerShell here-string (where
  backtick _is_ the escape), so it never appeared there — which is why alpha.8
  shipped with it.

  Fix: backslash-escape (`\$env:`) for a literal `$` in the unquoted heredoc.
  Added a regression test (`tests/packages/zephyr-installer/write-activation.test.ts`)
  that sources `write-activation.sh` under `set -eu` and asserts the env-vars
  files are written cleanly with literal `$env:` — the existing tests only ran
  `--dry-run`, which skips `write_activation()`, so the path was uncovered.

## 1.0.0-alpha.8

### Minor Changes

- ## Cross-platform Zephyr toolchain installer

  New **`@typecad/zephyr-installer`** package: a one-command, cross-platform
  (Linux / macOS / Windows-native) installer for a working Zephyr build
  environment on micromamba + the official Zephyr SDK. No preinstalled
  conda/Python/toolchain required.

  `node packages/zephyr-installer/install.mjs` dispatches to `install.sh` (POSIX)
  or `install.ps1` (Windows) and: downloads micromamba, creates a `zephyr` conda
  env (host tools from conda-forge; `dtc`/`openocd` on POSIX and `7zip` on Windows
  installed as platform-specific extras, since micromamba ignores `environment.yml`
  line selectors), fetches + SHA256-verifies the Zephyr SDK full bundle (located
  outside the env prefix, idempotent, no `setup.sh`/`sudo` — relies on
  `ZEPHYR_SDK_INSTALL_DIR`), and runs `west init --mr <rev>` + `west update` for a
  vanilla Zephyr workspace.

  Run via `npx @typecad/zephyr-installer` (or the `zephyr-installer` /
  `typecad-zephyr-install` bin): the entry point prints a summary of what it
  will do — versions, bundle name, ~sizes, install locations — and waits for
  Enter before proceeding. `--yes` skips the prompt (CI); `--dry-run` prints the
  resolved plan and exits.

  Activation hooks export `ZEPHYR_BASE` + `ZEPHYR_SDK_INSTALL_DIR`, so once
  activated, `framework-zephyr`'s west discovery (Strategy 1 — `west` on PATH)
  finds the new install with zero code changes. A `templates/project/` ships
  machine-agnostic activators (`.typecad/activate-zephyr.{ps1,sh}`) plus a VS Code
  terminal profile that auto-activates on terminal open.

  Windows hardening (verified on PowerShell 5.1): downloads via `curl.exe` (not
  `Invoke-WebRequest`, which fails to resolve `api.anaconda.org` through the
  system proxy stack), explicit Windows `tar.exe` (MSYS `tar` mis-parses `C:\`
  paths), fail-fast `$LASTEXITCODE` checks on every native-exe call (no false
  "done" cascades), partial-env-prefix detection with an actionable error, and
  `micromamba shell init` so activation works in new shells without manual
  hook-loading.

  `@typecad/framework-zephyr` (patch): the actionable "west not found" error in
  `west-spawn.ts` now points users at the installer (`node packages/zephyr-installer/install.mjs`).

  Tests: 24 across dispatcher (incl. confirmation gate), dry-run, versions, and templates.
