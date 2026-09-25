---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

`typecad-hal sbom` + `typecad-hal audit` — the product-compliance record pair

Two new commands over the last build's own ground truth, never a heuristic
scan — the EU Cyber Resilience Act's technical-file obligations are the
design brief:

- **`typecad-hal sbom`** — a build-true software bill of materials in
  CycloneDX 1.6 JSON (default) or SPDX 2.3 JSON (generate-only): the Zephyr
  kernel plus the west modules the last build ACTUALLY compiled
  (linked-module filtering via `compile_commands.json`), each pinned by its
  checked-out commit SHA, plus the hashed `zephyr.bin` artifact, the board
  as a CycloneDX `device` component, and the toolchain in `formulation`
  (the build environment — deliberately NOT a runtime product component,
  the classic embedded SBOM mistake generic scanners make). Every
  successful build stamps `<buildDir>/sbom.cdx.json` best-effort — a stamp
  failure never fails the build. The serial number is a deterministic UUID
  v5 over the component identities, so `--check` regenerates and compares
  without false drift; `--diff` compares two documents. `--strict` treats
  floating manifest revisions and missing SHAs as integrity holes. Emitted
  documents validate against the official schemas, vendored in the test
  fixtures.
- **`typecad-hal audit`** — evaluates the last build's MERGED Kconfig
  (`<buildDir>/zephyr/.config` — the as-built truth, not config fragments)
  against a curated Zephyr security baseline, plus a `compatible` sweep of
  the resolved `zephyr.dts` as the attack-surface inventory. Rules are DATA
  (`SECURITY_RULES`) evaluated over config/devicetree facts — never
  board-name or SoC branches; a rule keys on `CONFIG_*`, and each carries
  the CRA essential-requirement paraphrase that ties the finding to the
  regulation. Justified exceptions are DEVIATIONS, not suppressed findings:
  a committed `.typecad-hal/audit-waivers.json` (`{ rule, justification,
  date }`) moves a finding into the recorded-deviations section — an empty
  justification is rejected, because an unjustified waiver is just a muted
  alarm. Every run writes `<buildDir>/security-audit.json` (schema
  `typecad-hal/security-audit@1`) — the machine-readable record the future
  CRA technical-file bundle and VEX work consume. `--strict` exits 1 on any
  unwaived high/medium finding; `--json` prints only the report.
- **Shared ground truth** — `west-inventory.ts` is the as-built inventory
  both `licenses` and `sbom` report from (the linked-module filtering and
  build-directory discovery, moved out of licenses.ts when the sbom command
  grew a second consumer): keep both consumers on the one inventory.
