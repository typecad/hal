---
'@typecad/cuttlefish': patch
---

create: bake SRST-pin flash quirks into the scaffolded config. Boards whose `support/openocd.cfg` declares an srst-based `reset_config` without `connect_assert_srst` (the WeAct BlackPill's cfg says `reset_config srst_only`, and its SWD header breaks no NRST out) now get `zephyr.runnerArgs: ['--cmd-pre-init=reset_config none']` written into `cuttlefish.config.ts` at create time, with a comment naming the failure it prevents — west's `reset init` timing out with "timed out while waiting for target halted" when the probe's NRST line doesn't reach the target. The quirk is sourced from the board catalog's captured cfg facts (not board names), so every board with the same shape gets it; boards declaring `connect_assert_srst` keep their connect-under-reset strategy (the pin is provably wired there).
