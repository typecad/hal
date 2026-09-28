---
'@typecad/cuttlefish': patch
---

Repo hygiene, no runtime impact: untrack the bench-scratch artifacts that
rode in with the "bench scratch" commit — the rawlisten serial-listener
source and its compiled Windows `.exe` at the repo root, the `.probe/`
font-metrics extracts, and a stray empty `x` — none referenced by any
source. Swept ignored scratch from disk (a 58k-directory `.build/tests`
test-run leak, the `tmp-scaffold/` throwaway project) and dropped six
stale stashes, each verified superseded by the history rewrite before
removal. Published tarballs never contained any of it (npm packs
per-package); this keeps a fresh clone clean.
