---
"@typecad/zephyr-installer": patch
---

## Pin SHA256 for the linux-x86_64 + windows-x86_64 SDK bundles

`versions.env` shipped with every `SHA256_*` set to `TODO`, so `fetch-sdk`
skipped verification with a warning. Pinned the two bundles exercised by real
installs (each computed by the installer against the official Zephyr SDK 0.17.4
release bundle):

- `linux-x86_64`: `83f2f327…3d1116b6`
- `windows-x86_64`: `51d550eb…d9384ecd`

Verification is now enforced on those platforms — a mismatch aborts the install
instead of continuing. The other three (`linux-aarch64`, `macos-x86_64`,
`macos-aarch64`) remain `TODO` until a real install on each platform computes
and pins them (the installer prints the computed hash on first download).

Also adds a regression test that locks the two pinned values so a typo or
accidental `TODO`-reset in `versions.env` is caught.
