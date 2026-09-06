---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

BLE GATT joins the thin HAL — the Arduino-bluedroid-style Ble singleton is
replaced by a fact-first peripheral.

The new `BLE(name)` carries the advertised identity at construction; the GATT
database is declared through `service()/char()` chains (each char's
uuid/type/perms ride its add op — the per-file declaration counter assigns
indices), handlers attach with onRead/onWrite right where the characteristic
is declared, and `notify(index, value)` pushes by declaration order.
`start()` registers the deferred service table + bt_enable + advertises;
`stop()/linked()/clients()/onConnect()/onDrop()` map 1:1 onto the bt_*
surface. The GATT catalog (GATT.ENVIRONMENTAL…) stays as reference data.
Removed: the Ble/BleServer singletons, BleStatus/BleAdvertisingMode enums,
and 5 op kinds end-to-end (status, until_connected, until_connected_start,
set_name, set_tx_power — all either unsupported or subsumed).

Five real firmware bugs fixed on the way to hardware green, all in the
Zephyr GATT shim:
- **No CCC descriptors were emitted** — a central could never subscribe and
  notifications had nowhere to land. The table builder now appends a managed
  CCC (bt_gatt_ccc_managed_user_data with a no-op cfg_changed) after each
  notify characteristic.
- **utf8 reads were UB**: hoisted string callbacks return std::string by
  value; the dispatcher called them through a const char* fn pointer and
  strung strlen over garbage. It now calls through the true signature and
  borrows c_str() for the copy.
- **NULL-conn notify asserted the ESP32 controller** (lld_con.c 3327):
  bt_gatt_notify(NULL, …) on the first push after subscription crashes the
  S3 link layer. Notify now uses the stored active connection and no-ops
  when the link is down.
- **notify() keyed off the shim's current_char** — wrong target for any
  standalone push after later declarations. The lowering now uses the op's
  declaration index (the shim's val_attr_idx table).
- **BlePerm token expressions resolved as numbers** (always 0) — the plugin
  case now reads the token text that resolveBlePermExpr maps.

The two-terminal hardware suite is restored from history and ported:
`packages/hal/tests/network/ble-client.ts` (host noble central; scan window
widened + discovery retry for Windows noble flakiness) against
`ble-peripheral.test.ts` (now the thin API) — discovery, connect, five typed
reads incl. utf8 and 128-bit UUIDs, write round-trip, subscribe+notify, and
clean disconnect. Verified GREEN twice consecutively on the ESP32-S3: the
peripheral's 6 asserts + SUITE_END over a raw serial capture, and the
central's 12 checks — `npm run test:hw:ble:full` drives the pipeline
(dry-run build → west flash → serial-watch → central). The in-harness
serial reader proved DTR-flaky on the CH34x-bridged S3 and is bypassed by
the orchestrator's raw watcher.
