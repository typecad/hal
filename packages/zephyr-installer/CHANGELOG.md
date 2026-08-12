# @typecad/zephyr-installer

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
