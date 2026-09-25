# Vendored SBOM JSON schemas (test fixtures)

- `bom-1.6.schema.json` — CycloneDX 1.6 BOM schema, from
  https://github.com/CycloneDX/specification/blob/master/schema/bom-1.6.schema.json
  (Apache License 2.0).
- `spdx.schema.json` — CycloneDX's SPDX license-id list, referenced by
  `bom-1.6.schema.json`'s `license.id`, from
  https://github.com/CycloneDX/specification/blob/master/schema/spdx.schema.json
  (Apache License 2.0).
- `jsf-0.82.schema.json` — CycloneDX JSON Signature Format schema, referenced by
  `bom-1.6.schema.json`'s `signature`, from
  https://github.com/CycloneDX/specification/blob/master/schema/jsf-0.82.schema.json
  (Apache License 2.0).
- `spdx-2.3.schema.json` — SPDX 2.3 JSON schema, from
  https://github.com/spdx/spdx-spec/blob/v2.3/schemas/spdx-schema.json
  (upstream repository MIT-licensed).

Fetched 2026-09-22 to validate the sbom command's emitted documents in
sbom.test.ts. Do not hand-edit; re-fetch from the sources above.
