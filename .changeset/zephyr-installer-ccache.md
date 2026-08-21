---
"@typecad/zephyr-installer": minor
---

## ccache in the build env: fresh build dirs replay from cache

The micromamba env now installs `ccache` (conda-forge, all platforms). Zephyr's
`cmake/modules/ccache.cmake` automatically routes compiles and links through
ccache whenever it is on PATH — no extra wiring. Build dirs that legitimately
start fresh (config/board changes, the framework's dependency-cycle recovery)
then hit the cache for every unchanged Zephyr library object instead of
recompiling ~280 files from scratch. ccache's per-user default cache dir is
shared across projects; opt out with `USE_CCACHE=0`.
