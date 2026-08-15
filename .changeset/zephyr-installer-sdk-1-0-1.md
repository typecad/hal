---
"@typecad/zephyr-installer": patch
---

## Upgrade to Zephyr SDK 1.0.1 (Zephyr 4.4-compatible)

Zephyr 4.4 requires the SDK 1.0.x line, which renamed its artifacts — installing
1.0.x with the old names (or 0.17.4 against Zephyr 4.4) produced build errors.

- `versions.env`: `ZEPHYR_SDK_VERSION=1.0.1` + `ZEPHYR_SDK_BUNDLE_SUFFIX=_gnu`
  (1.0.x dropped "full" bundles; `_gnu` = all GNU toolchains + host tools).
- **Full-bundle names** append the suffix everywhere (`install.sh`,
  `install.ps1`, `install.mjs` summary):
  `zephyr-sdk-1.0.1_<plat>_gnu.<ext>`.
- **Selective-install toolchain tarballs use the flavor infix** — 1.0.x names
  them `toolchain_gnu_<plat>_<target>.<ext>` (0.17.x had no infix). Without
  this, every `--platforms`/`--modify` download would 404. The minimal bundle
  name is unchanged (`_minimal`, no flavor).
- Fresh SHA256s from the release's official `sha256.sum` for linux-x86_64,
  linux-aarch64, macos-aarch64, and windows-x86_64 — verification is now
  enforced on all four.
- **macOS Intel (`macos-x86_64`) has no 1.0.x build** — `SHA256_macos_x86_64`
  is the explicit `NONE` sentinel and `fetch-sdk` fails fast with guidance
  (use an ARM Mac, or `--sdk-version 0.17.4` for the Zephyr 4.3.x line).
- ESP32 note: the xtensa-espressif toolchains are **individual 1.0.x assets**
  (`toolchain_gnu_<plat>_xtensa-espressif_esp32s3_zephyr-elf.tar.xz`, verified
  in `sha256.sum`) so `--platforms esp32` works; the `_gnu` bundle itself may
  not preinstall them, in which case Zephyr's espressif HAL fetches them during
  the first ESP32 build.

All artifact URLs HEAD-checked against the v1.0.1 release (bundle, minimal,
and toolchain tarballs → 200). Tests updated: new hashes pinned, `_gnu` bundle
name asserted across entry points, toolchain-infix wiring guarded.
