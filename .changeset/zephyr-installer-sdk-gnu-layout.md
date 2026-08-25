---
'@typecad/zephyr-installer': patch
---

## Fix selective SDK installs for the 1.0.x `gnu/` layout

SDK 1.0.x installs toolchains under `<sdk>/gnu/` — its cmake resolves
`TOOLCHAIN_HOME` to `${ZEPHYR_SDK_INSTALL_DIR}/gnu` and its setup.cmd
installs with `pushd gnu; 7z x`. The selective/`--platforms`/`--modify`
paths extracted individual toolchain archives at the SDK root (the 0.17.x
layout), which builds fine against pre-4.4 Zephyr but fails on 4.4+ with
"Unable to find 'x86_64-zephyr-elf' or any other architecture in
`<sdk>/gnu`". Both installers now extract into `gnu/` on 1.0.x, migrate
misplaced SDK-root copies into `gnu/` instead of re-downloading, treat a
target dir without `bin/` as a hollow leftover (e.g. a failed setup.cmd
download) and re-download it, and the deselection cleanup scans both
locations. Also fixes the POSIX installed-toolchain listing to match
multi-segment xtensa targets (they were never seen as installed, so
deselection never removed them).
