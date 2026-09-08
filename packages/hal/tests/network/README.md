# packages/hal/tests/network — on-hardware network suites

These are `@typecad/hal/testing` hardware tests: TypeScript that compiles to
firmware, flashes to a board, and reports pass/fail over serial. They are
**excluded** from the normal Vitest suite (see the root
`vitest.config.ts` `exclude`) and run via the `typecad-hal test` CLI.

## HTTP / MQTT (`test:http` / `test:hw:http`)

The firmware is the **client**. `npm run test:http` starts a local Node server
(HTTP/HTTPS/MQTT) on the host; the ESP32 firmware (`http-client.test.ts` /
`mqtt-client.test.ts`) connects to WiFi and hits it. One terminal runs the
server, the other runs the firmware:

```bash
# Terminal 1 — host server (detects LAN IP, writes secrets.ts)
npm run test:http
# Terminal 2 — firmware client
npm run test:hw:http -- --port COM10   # repo root
```

## BLE (`test:ble` / `test:hw:ble`) — the inverted case

BLE is architecturally inverted from the HTTP test: the firmware is the **GATT
peripheral** (it advertises; `@typecad/hal` `Ble` is peripheral-only), so the
**host PC must be the GATT central**. The host client cannot be transpiled into
firmware — `@abandonware/noble` is a native Node BLE stack — so it runs in plain
Node, like `start-server.ts`.

```
  ┌──────────────┐   advertise "CuttlefishTest"   ┌─────────────┐
  │ XIAO nRF52840│ ◀───────────────────────────── │  host noble │
  │  fw peripheral GATT read/write/notify        │  central    │
  └──────────────┘ ◀────────────────────────────▶ └─────────────┘
   ble-peripheral                  ble-client.ts (npm run test:ble)
    .test.ts (UF2 flash)
```

The BLE link itself is the coordination — the same shape as
`mqtt-client.test.ts` busy-waiting on the broker: the host central connecting
flips `Ble.isConnected()` on the peripheral, the write callback fires when the
host writes the setpoint, and `onConnect`/`onDisconnect` increment counters the
test asserts.

### Target board

The default target is the **Seeed XIAO nRF52840** (`xiao_ble`) — a native BLE
board. The config (`ble-demo.config.ts`) selects it:

- `target: 'nrf52'`, `board: '@typecad/board-xiao-nrf52840'`,
  `mcu: '@typecad/mcu-nrf52840'`, `frameworkData.buildTarget: 'xiao_ble'`.
- **Flash via UF2** (`zephyr.runner: 'uf2'`): the XIAO exposes a UF2
  mass-storage bootloader. `west flash --runner uf2` copies the firmware to the
  mounted drive — **not** a serial port. Double-tap reset to enter the
  bootloader before flashing.
- The `--port` flag is for the **serial read** of test results: after the UF2
  flash reboots the board, the expect harness reads the `[TC:*]` protocol lines
  over the board's USB-CDC serial (e.g. `COM14`).

To retarget to a different board, edit `ble-demo.config.ts` (`target`/`board`/
`mcu`/`frameworkData.buildTarget`) and the `zephyr.runner` (e.g. `nrfjprog` for
a J-Link, `esptool`/`pyocd` for others).

### UF2 flashing the XIAO nRF52840 (read before first flash)

`west flash --runner uf2` copies the firmware to a UF2 mass-storage drive the
board exposes **only while in bootloader mode**. It is NOT in that mode while
running application firmware — `west flash` then fails with
`No matching UF2 partitions found`.

To enter UF2 bootloader mode:

1. **Double-tap the reset (RST) button** quickly. The red LED fades in/out and a
   USB drive mounts (e.g. `XIAO-SENSE` or `XIAO`). On Windows it appears as a
   new removable drive letter.
2. Run the flash while the drive is mounted — `west flash --runner uf2` finds
   the partition and copies. The board reboots automatically into the new
   firmware when the copy completes.

**Port re-enumeration caveat:** the XIAO's USB-CDC serial number can shift on
reboot (e.g. `COM14` → `COM15`) after a UF2 flash, because Windows assigns a
new port when the device re-appears. If the expect harness reports
`Failed to open COM14: File not found` after a successful flash, re-list the
ports (`typecad-hal test` / Device Manager) and pass the post-flash port:

```bash
# After flashing, find the board's new CDC port (VID 2FE3, PID 0004):
node -e "require('serialport').SerialPort.list().then(p=>p.forEach(x=>console.log(x.path,x.vendorId,x.productId)))"
# Then re-run with the discovered port (the build is cached, so this skips
# straight to upload + serial):
npm run test:hw:ble -- --port COM15   # repo root
```

For a standalone flash (debug the link without the expect harness), build the
demo peripheral directly and flash it the same way:

```bash
cd demos/ble-demo
npx typecad-hal ./src/08-test-server.ts --compile --upload
```

### Files

| File | Side | Role |
|---|---|---|
| `ble-peripheral.test.ts` | firmware (peripheral) | Advertises `CuttlefishTest`, exposes the GATT table, asserts peripheral-visible state. Run with `test:hw:ble`. |
| `ble-client.ts` | host (central) | Scans, connects, reads/writes/subscribes, prints a TAP-style summary. Run with `test:ble`. |
| `ble-demo.config.ts` | — | `typecad-hal test` config for the peripheral side (target, port, timeout). |
| `../../demos/ble-demo/src/08-test-server.ts` | firmware (peripheral) | The combined peripheral that mirrors the test's GATT table — flash standalone to debug the link without the expect harness. |

### Two-terminal flow

```bash
# Terminal 1 — peripheral: flash + run the expect test (advertises, then waits)
#   (double-tap reset first to enter UF2 bootloader mode — see above)
npm run test:hw:ble -- --port COM14   # repo root

# Terminal 2 — central: connect, exercise GATT, print summary, exit
npm run test:ble
```

The peripheral must be advertising before the central starts (Terminal 2 waits
up to 30 s to scan for the advertised name `CuttlefishTest`).

### Feature coverage

The suite exercises every GATT feature the `demos/ble-demo` samples demonstrate:

- **Advertise discovery** — the central scans for the advertised name.
- **Read** — temperature `2A6E` (int16), humidity `2A6F` (uint16), battery
  `2A19` (uint8), plus peripheral-side assertion that `status()` is
  `Advertising` after `begin()`.
- **Write + read-back** — setpoint `2A1F` (int16 read+write): the central
  writes a value, reads it back, and the peripheral asserts its `onWrite`
  handler updated the stored value.
- **Notify / subscribe** — notifier `2A58` (int16 read+notify): the peripheral
  pushes every 2 s, the central subscribes and asserts the value.
- **Multi-service** — Environmental Sensing (`181A`) + Battery (`180F`) + a
  vendor 128-bit service; the central asserts ≥ 2 services discovered.
- **Custom 128-bit UUID** — vendor `a1b2c3d4-…` uint8 + utf8 read chars.
- **Connect/disconnect status** — `isConnected()`, `clientCount()`, and the
  `onConnect`/`onDisconnect` callbacks flip as the central connects/drops.

### Windows setup (noble / WinUSB) — read before first run

`@abandonware/bluetooth-hci-socket` talks the HCI transport over **WinUSB**, not
the Microsoft Bluetooth stack. This requires a one-time driver swap that
**disables normal Windows Bluetooth for that adapter** until you revert it. Use
a dedicated test adapter, or be ready to revert when you want your mouse/
headphones back.

1. **Install the VC++ 2015–2022 redistributable (x64)** — the native USB
   backend (`usb_device_winrt`/`WinUSB`) needs it. Download from
   <https://aka.ms/vs/17/release/vc_redist.x64.exe>.

2. **Replace the adapter driver with WinUSB via Zadig**:
   - Download Zadig from <https://zadig.akeo.ie> (run as Administrator).
   - **Options → List All Devices**.
   - Select your Bluetooth adapter (e.g. "Intel(R) Wireless Bluetooth(R)").
   - Set the target driver to **WinUSB** (libusb-win32 also works; WinUSB is
     recommended by noble).
   - **Replace Driver** and wait for it to finish.

3. **Verify** — `npm run test:ble` should now reach `stateChange poweredOn`
   and start scanning. If it errors with `unsupported`/`poweredOff`, the
   driver swap didn't take (reboot, or re-run Zadig).

**Reverting** (to restore normal Windows Bluetooth): Device Manager →
"Bluetooth" or "Universal Serial Bus devices" → your adapter → **Update
Driver** → "Browse my computer" → "Let me pick" → select the manufacturer
driver (Qualcomm/Intel/Realtek). Reboot.

On Linux/macOS noble uses the kernel HCI socket directly — no driver swap
needed, but the process needs `CAP_NET_RAW` (run as root, or
`setcap cap_net_raw+eip $(which node)`).

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| `No matching UF2 partitions found` | Board is in application mode, not UF2 bootloader mode. **Double-tap reset** (see "UF2 flashing" above) so the drive mounts, then re-run. |
| `Failed to open COM14: File not found` after a successful flash | UF2 flash rebooted the board and Windows re-enumerated the CDC port (e.g. COM14 → COM15). Re-list ports (VID 2FE3) and re-run with the new port. |
| `west flash: using runner nrfutil` / `Unable to find a board` | The `zephyr.runner: 'uf2'` config didn't reach the upload — fixed in the expect harness (upload now forwards `zephyrConfig`). Rebuild `@typecad/hal/testing` if you see this. |
| `Adapter never reached poweredOn` | WinUSB driver not bound (re-run Zadig), or adapter off. |
| `scan … timed out` | Peripheral not flashed / not advertising. Check Terminal 1 shows `advertising CuttlefishTest`. |
| `characteristic … not found` | GATT table mismatch between `08-test-server.ts` and `ble-client.ts` UUIDs. The two files must stay in sync (UUIDs + expected values are duplicated at the top of each). |
| Writes succeed but readback is stale | The `onWrite`→`onRead` echo has a race; `ble-client.ts` waits 500 ms after the write before readback. Increase if your adapter is slow. |
| Notify never arrives | CCCD subscribe didn't land. `ble-client.ts` subscribes before waiting; re-run with a powered adapter. |
