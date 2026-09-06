---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

WiFi joins the thin HAL: the Arduino-ESP32-style singleton is replaced by
fact-carrying station/AP classes.

The new `WiFi(ssid, opts)` carries the link policy at construction — psk,
security (WiFi.OPEN/WPA2/WPA3/WPA2_WPA3 tokens, defaulting from the psk),
band, channel, join timeout, powerSave (PS_OFF), and static ipv4 facts
(addr/gateway/netmask, applied via net_if instead of DHCP — previously
unsupported). `join()` associates from those facts through net_mgmt and
bounded-waits on the L4 connected flag, returning a boolean (no exceptions);
`joinStart()` stages the association for polling or the async split;
`leave()/linked()/rssi()/ip()/mac()/onUp()/onDrop()` map 1:1 onto the
existing iface-status/net_if/event surfaces. `scan()` returns a `Scan`
handle over the fixed 16-entry pool (count/ssid/rssi/channel/security).
`WiFiAP(ssid, {psk, channel})` carries the SoftAP facts with start()/stop().

Removed: the fat 34-method surface — connect/connectAsync/untilConnected/
untilDisconnected/waitConnected/waitDisconnected pairing, the setter dance
(hostname/staticIP/autoReconnect/powerSave/txPower), AP setters, and the
unsupported credentials trio (17 op kinds deleted end-to-end; wifi.join is
the new fact-carrying kind). The async machinery splits awaited wifi.join
into connect_start + the L4 poll.

The Zephyr shim's join applies static IPv4 via net_if_ipv4_addr_add +
set_netmask_by_addr (the old set_netmask is __deprecated) + set_gw, and the
PS_OFF fact through the modern wifi_ps_params shape. The instance
transformer captures WiFi construction facts (ssid/opts/ipv4) like the other
thin classes. wifi-demo's 11 programs are migrated and the demo west-compiles
clean for esp32_devkitc (requires `west blobs fetch hal_espressif` once).

Hardware-verified on an ESP32-S3 devkitC: the new
framework-zephyr/hal/esp32s3/wifi.test.ts joins a real WPA2 network from
construction facts (association + DHCP in ~5s), reads back ip/rssi/mac,
scans the neighborhood through the pool handle, and leaves — 15/15 rig
tests green alongside the core HAL suite. Fixes made on the way: absent
WiFi facts now carry "undefined" sentinels the plugin strips (previously
leaked as raw `this->_field` text), and the SPI transceiver unwraps the
nullish-lowered `rx ?? new Uint8Array(0)` default to the caller's buffer
identifier.

Known follow-ups surfaced by compiling the demo and rig: (1) pre-existing async
generator bug — a HAL-op statement immediately before an await renders as a
bare `{` (demo 03's heartbeat works around it); (2) awaited instance methods
rebind the inlined class body's `this` to the generated task class, so
awaited wifi.join() inside async bodies is staged-join + poll for now;
(3) a Uint8Array rx buffer passed to SPITarget.transceive is consumed
opaquely by the op resolver — its declaration tree-shakes out of the
generated C++ (the empty-bus rig test uses the write-only form until the
buffer path lands).
