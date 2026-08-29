---
'@typecad/framework-zephyr': minor
---

## bossac on Windows

`west flash` on SAM-DA-bootloader boards (SAMD — the Arduino Nano 33 IoT,
Zero, MKR series) uses the bossac runner, and bossac ships in nothing Zephyr
provides: not the SDK bundle, not a west module, not conda-forge. Zephyr's
FindHostTools also resolves `find_program(BOSSAC)` at build-configure time,
so a missing binary bakes `BOSSAC-NOTFOUND` into the runner args and the
flash dies with "required program bossac not found" — installing bossac
afterwards requires a re-configure to take effect. install.ps1 now extracts
the official upstream BOSSA MSI (SHA256-pinned in versions.env) with the
env's 7z and drops its self-contained bossac.exe (system DLLs only) into
the env's Library\bin — on the activation PATH and on the PATH of the
`micromamba run` west flash the framework spawns. Idempotent;
warn-and-continue (only affects SAM-BA boards). install.sh prints per-OS
install hints on POSIX (apt bossa-cli, brew bossa).
