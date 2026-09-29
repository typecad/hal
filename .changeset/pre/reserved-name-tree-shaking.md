---
'@typecad/cuttlefish': patch
---

Fix for the "vanishing declaration" found while validating the reserved-name
rename work — plus a corrected diagnosis:

- **The real bug: tree-shaking dropped reserved-named variables.** A
  declaration like `const log = new EventLog(16)` vanished from the output
  while every reference to it survived, failing the compile with an
  undeclared symbol. Mechanism: references bake the reserved-name ESCAPE
  into callee text (`log_->record`), the call graph's identifier collector
  derives symbol names from that text (`log_`), and tree-shaking compared
  against the declared TS name (`log`) — no match, so the declaration was
  shaken out. Fix: a var_decl now records its render name
  (`emittedName`) when it differs from the TS name, and the reachability
  analysis maps an reachable escape back to its declaration. Verified in
  the bench-supervisor demo, whose event log is named `log` again at its
  natural position (compiles, passes --autosar=strict); pinned by a unit
  test against the reachability analysis (the single-file harness cannot
  exercise tree-shaking — every top-level statement is an entry there).
- **Corrected diagnosis + hardened emit path.** The earlier "class-emitter
  captures the declaration" theory was a misread of filtered probe output —
  the declaration always landed in main(); the pinned `it.fails` is
  replaced by a positive test parsing the class body precisely. Along the
  way, top-level-prep's reserved-name DECLARATION SUPPRESSION was narrowed
  to platform passthrough macros (its original Arduino-macro rationale):
  merely-reserved names are user variables that rename consistently, not
  platform symbols to shadow — suppressing them dropped declarations whose
  references the escape machinery happily emitted.
