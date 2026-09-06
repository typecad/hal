---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

USBConsole and Store join the thin HAL — the Arduino-Serial console and the
NVS session model are replaced by fact-carriers with Zephyr verbs.

`new USBConsole('USB0')` carries the CDC instance; `open()` starts the USB
device stack (the baud parameter is gone — CDC line coding is the host's
business); `write()/writeLine()` take typed string|number (the `any`-typed
print/println/printf family and the `usb.printf`/`usb.write` ops are
removed); `ready()` is the DTR query; `waitReady(timeoutMs)` is a NEW op —
one bounded DTR poll with k_msleep slices in the lowering, replacing the
TS busy-loop `waitForConnection`; `read()/available()` keep their poll
semantics. `close()`/`usb.flush` are observable no-ops (flush op removed).

`new Store('app')` carries the namespace as the construction fact; the
begin(name, readOnly)/end() session dance is gone along with the
`preferences.begin`/`end` ops — every op now composes its full settings
name (`tc/<ns>/<key>`) at emit time, and the shim's begin-time prefix
state is deleted. Four typed pairs (Int/Float/Bool/String — the UInt pair
and its ops are removed; both were 4-byte writes) plus remove(key) and
clear() over the namespace. Get defaults are REQUIRED parameters — the
implicit `= 0` magic values are gone. The transformer captures the
namespace like every other thin-class fact, and put values accept runtime
expressions (`store.setInt('n', store.getInt('n', 0) + 1)` lowers).

Two real persistence bugs fixed in the ZMS shim, found by the new
cross-flash hardware test:
- `settings_subsys_init()/settings_load()` were only reachable through the
  deleted `begin()` — every put/get silently ran against the RAM cache and
  nothing ever hit flash. All entry points now mount lazily.
- The `h_set` load callback stashed names relative to the handler's "tc"
  subtree ("rig/marker") while lookups use full names — loaded entries
  never matched, so values never survived a reboot even once flash writes
  worked. The subtree prefix is re-attached at load.

Hardware-verified on the ESP32-S3 (new `store.test.ts` in the hal rig):
all five typed round-trips pass against the real settings/ZMS backend, and
the marker key demonstrably survives re-flashing the application — written
through ZMS to the storage partition at 0x3b0000, read back on the next
flash (verified by consecutive green rig runs and a raw esptool dump of
the partition). All USBConsole consumers (2 mcu packages, 5 boards'
pins.ts) are migrated to the new class name.
