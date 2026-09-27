---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

Contract projects can now declare `storageKb` in typecad-hal.config.ts —
the on-chip flash size in KB — which gates in the persistent Store/File
surface when neither the soc-dtsi flash harvest nor a buildTarget catalog
record declares a size. External-flash boards (RP2040/ESP32 class) declare
flash in the board dts, which the soc-dtsi harvest can never see, so their
contract boards silently shipped without Store and users had to shim
around the gate with raw settings access. The declaration overrides the
dtsi harvest; a buildTarget catalog record still wins (it is the tree west
actually compiles against).
