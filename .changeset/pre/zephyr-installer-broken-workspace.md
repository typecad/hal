---
"@typecad/zephyr-installer": patch
---

## Fix: recover from a broken `.west/` (missing config) instead of failing west update

`init-workspace` checked only for `.west/` and skipped `west init` when present. But a
workspace can have `.west/` without `.west/config` (interrupted/partial init), which
makes `west update` fail:

```
west.configuration.MalformedConfig: local configuration file not found
```

Now requires BOTH `.west/` and `.west/config`; if `.west/` exists without its config,
it removes the partial `.west/` and re-initializes. The cloned `zephyr/` and `modules/`
are preserved — `west update` re-syncs them, so there's no full re-clone. Mirrored in
`install.sh` and `install.ps1`.
