// 11 — HTTPS with insecure for lab devices without a proper CA chain.
// Skips certificate verification — development use only.
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Request, Time } from '@typecad/hal';
import { UART0 } from '@typecad/board';

const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PASSWORD });
wifi.join();

const req = new Request(Request.GET, "https://self-signed.local/status", { insecure: true });
req.send();
UART0.writeLine(req.status());

while (true) {
  Time.sleep(1000);
}
