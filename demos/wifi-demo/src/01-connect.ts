// 01 — minimal: connect and print the acquired IP.
// === EDIT THESE BEFORE FLASHING ===
const WIFI_SSID = "Skynet";
const WIFI_PASSWORD = "justin04";
// ==================================

import { WiFi, delay } from '@typecad/hal';

WiFi.connect(WIFI_SSID, WIFI_PASSWORD);
console.log(WiFi.localIP());

while (true) {
  delay(1000);
}
