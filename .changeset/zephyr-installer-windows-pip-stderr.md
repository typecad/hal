---
'@typecad/zephyr-installer': patch
---

Fix a Windows crash at the very end of the install: PowerShell 5.1 treats redirected native stderr (`2>&1`) as a terminating `NativeCommandError` under `$ErrorActionPreference='Stop'`, so pip's live `Running command git clone ...` relay for git-pinned packages (silabs' `cmsis-svd`) aborted the installer mid-requirements even though pip was succeeding. The module pip step no longer redirects stderr (exit codes are the failure signal). Re-running the installer also now re-pins the west manifest revision on an adopted workspace — a pre-existing workspace tracking `main` converged onto the installer's pinned Zephyr tag instead of drifting out of sync with the SDK version it installs.
