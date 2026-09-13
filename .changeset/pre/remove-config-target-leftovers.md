---
"@typecad/cuttlefish": patch
---

fix(config): remove the remaining `target` config-surface leftovers and the test-runner's favorite-board default. The Zod schema still accepted `target` (with a stale doc comment calling it required), the config loader still extracted it into the resolved config and fed it to validation, and `target` still sat in the known-keys list — all dead since the field left `TypecadConfig`; a legacy config carrying `target:` now gets the unknown-top-level-key warning like any other unrecognized key. The hardware test runner no longer defaults `board` to `'xiao_ble/nrf52840'` when the config declares none — that silently built and flashed a XIAO BLE image for a boardless project; an unset board now resolves to empty and fails honestly at the toolchain instead. The `--help` example pairing an xiao_ble board with a blackpill buildTarget is coherent now too.
