---
"@typecad/zephyr-installer": minor
---

## Selective platform installation + `--modify` reconfiguration

A full install downloads the 1.5 GB SDK bundle (all 25+ toolchains). Most users
need one or two platforms. The installer now downloads the ~10 MB minimal bundle
(cmake config + sdk_version) plus only the selected toolchains:

```sh
npx @typecad/zephyr-installer              # interactive platform checklist
npx @typecad/zephyr-installer --modify     # add/remove platforms later
npx @typecad/zephyr-installer --platforms arm,esp32   # non-interactive
npx @typecad/zephyr-installer --platforms all          # full bundle (previous behavior)
```

### Platform groups

| Group | Toolchain(s) | Covers | ~Download |
|-------|-------------|--------|-----------|
| ARM Cortex-M | `arm-zephyr-eabi` | nRF, RP2040, STM32, SAMD | ~150 MB |
| ESP32 | `xtensa-espressif_esp32{,s2,s3}_zephyr-elf` | ESP32/S2/S3 | ~300 MB |
| RISC-V | `riscv64-zephyr-elf` | ESP32-C3/C6 | ~120 MB |
| x86 | `x86_64-zephyr-elf` | native_sim | ~100 MB |
| aarch64 | `aarch64-zephyr-elf` | ARM64 boards | ~100 MB |
| All | (full bundle) | everything | ~1.5 GB |

### Interactive checklist

```
Select platform toolchains to install:

  [1] ARM Cortex-M (nRF, RP2040, STM32, SAMD, ...)      ~150 MB  installed
  [2] ESP32 / ESP32-S2 / ESP32-S3 (Xtensa)              ~300 MB
  [3] RISC-V (ESP32-C3/C6, generic RISC-V)              ~120 MB
  [4] x86 / native_sim                                  ~100 MB
  [a] All (full bundle, ~1.5 GB download / ~11 GB extracted)

Enter selection (e.g. '1 2', 'arm,esp32', or 'all'):
```

### `--modify` (reconfigure an existing install)

Re-runs the checklist with installed toolchains marked, then applies the delta:
new selections download (idempotent per-toolchain), deselections delete their
toolchain dirs. Skips the env/workspace steps — SDK platforms only. The
selection persists in `$SDK_INSTALL_DIR/.typecad-platforms`.

### Line-ending safety

`.gitattributes` now forces `*.sh`/`*.mjs`/`*.env`/`environment.yml` to LF-only
(`text eol=lf`), preventing CRLF conversion on Windows checkouts that would
break bash on Linux with `$'\r': command not found`.
