// 01 — thin station join: construction facts + one bounded verb.
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, UART0 } from '@typecad/hal';

const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PASSWORD, timeoutMs: 15000 });

if (!wifi.join()) {
  UART0.writeLine("join failed");
} else {
  UART0.writeLine(wifi.ip());
}

while (true) { /* idle */ }
