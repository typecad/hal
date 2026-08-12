---
"@typecad/zephyr-installer": patch
---

## Fix: SDK download aborted on POSIX (write-activation heredoc bug)

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
backtick *is* the escape), so it never appeared there — which is why alpha.8
shipped with it.

Fix: backslash-escape (`\$env:`) for a literal `$` in the unquoted heredoc.
Added a regression test (`tests/packages/zephyr-installer/write-activation.test.ts`)
that sources `write-activation.sh` under `set -eu` and asserts the env-vars
files are written cleanly with literal `$env:` — the existing tests only ran
`--dry-run`, which skips `write_activation()`, so the path was uncovered.
