---
'@typecad/zephyr-installer': minor
---

## dfu-util on Windows + pyusb in the env

- **dfu-util (Windows).** `west flash` on USB-DFU boards (the STM32 ROM
  bootloader — e.g. the Black Pill) shells out to dfu-util, and a missing
  executable dies with a raw `FileNotFoundError`. conda-forge has no
  dfu-util build, so install.ps1 now fetches MSYS2's mingw64 dfu-util
  package plus its libusb/libwinpthread DLLs (SHA256-pinned in
  versions.env) into the env's `Library\bin` — on the activation PATH and
  on the PATH of the `micromamba run` west flash the framework spawns.
  Idempotent; warn-and-continue on failure. install.sh prints the per-OS
  install command on POSIX instead (no auto-sudo).
- **pyusb.** west's runner registry imports every flash runner; `rtsflash`
  wants `import usb`. Without pyusb every west build/flash prints a
  "runner could not be imported" warning — now in environment.yml for all
  platforms.
