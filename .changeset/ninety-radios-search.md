---
'@typecad/cuttlefish': patch
---

Fix the create wizard's board picker when `typecad-hal create` is spawned by
a parent tool (e.g. `typecad-pcb create`) instead of run directly in a
terminal. The raw-mode filterable select needs byte-by-byte stdin a piped
child never reliably gets, so the wizard sat at the board prompt accepting
no input and no error. The picker now degrades to a line-based search
(query → numbered matches → pick-or-refine) whenever stdin is not a TTY, and
every wizard prompt fails fast with an actionable message (run create in a
terminal, or pass --board <identifier> / --framework / --probe / --port /
--baud) when stdin closes instead of hanging forever.
