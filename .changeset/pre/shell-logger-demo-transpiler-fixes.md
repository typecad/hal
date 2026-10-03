---
'@typecad/cuttlefish': patch
'@typecad/framework-zephyr': patch
---

Eight fixes surfaced by the new `zephyr-shell-logger` demo (round 3 of the
find-issues series: a $CMD,field*CS sentence shell over USB CDC with a
littlefs settings file and an async boot — the first demo on the USB/File/
async surface):

- **parseInt dropped its radix**: `parseInt('2A', 16)` lowered to base-10
  `atoi`, parsing as 2 — every hex checksum in the shell's grammar failed.
  A literal radix 16/8/2 now lowers to `strtol(..., nullptr, base)` at both
  the global and Number.parseInt call sites.
- **USB-only programs lost the shared write helper**: `__tc_dev_put` serves
  UART and CDC writes but rode the CUTTLEFISH_UART marker family, which the
  emit backstop strips whenever usesUart is false. It now carries its own
  CUTTLEFISH_SERIAL_WRITE marker pair, stripped only when neither serial
  surface is used.
- **The File path is a construction fact**: `new File(SETTINGS_PATH)` with
  a NAMED string constant left `_path` uncaptured and every fs op baked the
  literal `this->_path` (compile error). The capture const-folds named
  constants via the new resolveConstStringExpr (mirroring the Watchdog
  numeric fold).
- **fs.write_text content was literalized**: `quoteNonIdentifier` baked a
  call expression into a string LITERAL (the store put_string bug class,
  now on the fs path). Content passes verbatim; std::string values take
  `.c_str()` at the shim boundary.
- **for-of over a string is compilable**: the `const char* it, ch = *it`
  for-header declarator made `ch` a CONST CHAR (the pointer binds to the
  declarator), so its per-iteration reassignment was ill-formed — and the
  one-string-model charCodeAt takes const std::string&, which a char does
  not convert to. Lowered to an index loop over a once-evaluated string
  copy with a mutable char loop var; char/charAt/charCodeAt gained char
  overloads.
- **Gates agree with the lowerings**: Number.parseInt/parseFloat/isFinite/
  isNaN ARE lowered (round 2) but the eslint selector and the semantic
  prescan still banned all Number statics — only isInteger/isSafeInteger
  stay banned. `no-destructured-without-init` no longer fires on for-of
  declarators (the supported destructuring shape — its guard also checked
  the wrong AST level).
- **usb.read casts via static_cast**: the C-style `(int)__b` tripped
  AUTOSAR M5-0-7 under --autosar=strict.
- **Map method receivers resolve through classFields**: a plain
  (non-??-guarded) `.get()` on a `this._map` field emitted verbatim
  (`std::map` has no `.get`) — the receiver resolution now consults the
  class-field map, and an `identifier.field` receiver resolves its type
  through the owning class IR so ambiguous string/array methods dispatch
  correctly.

Also updates four stale expectations from the newer main-stack-floor,
shadow-struct-uniquing, and pop-contract commits (kconfig 8192, packet-lab
uniqued struct name, bench-supervisor __tc_pop), which were failing on
main before this change.
