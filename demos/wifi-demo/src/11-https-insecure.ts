// 11 — HTTPS with insecure() for lab devices without a proper CA chain.
// Skips certificate verification — development use only.
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Http, delay } from '@typecad/hal';

WiFi.connect(WIFI_SSID, WIFI_PASSWORD);

const req = Http.get("https://self-signed.local/status");
req.insecure();
req.send();
console.log(req.status());

while (true) {
  delay(1000);
}
