---
"@typecad/cuttlefish": patch
---

fix(config): drop the dead `target` field from `TypecadConfig`. Nothing has consumed it since the consolidation refactor — the config loader treats it as an optional passthrough, the schema ignores it, the CLI never forwards it to the transpiler, and the scaffolder stopped emitting it — but the type still declared it as REQUIRED, so every project config without it failed the editor's type-check ("Property 'target' is missing in type … but required in type 'TypecadConfig'"). Removed the field from the type, the stale `target:` lines from the demo-contract-board and native_demo configs, and the test-runner's synthesized build-config passthrough that copied it into generated configs. Legacy configs carrying `target:` still parse (the lenient readers are unchanged); they just no longer type-check against the config type.
