// 02 — configured connect: hostname, power-save off, custom timeout, failure
// handling. (staticIP is not available on Zephyr — configure via DHCP or
// devicetree network provisioning instead.)
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, delay } from '@typecad/hal';

WiFi.hostname("sensor-01")
    .powerSave("none");

if (!WiFi.connect(WIFI_SSID, WIFI_PASSWORD, 30000)) {
  console.error("connect failed");
} else {
  console.log(WiFi.localIP());
  console.log(WiFi.macAddress());
  console.log(WiFi.rssi());
}

while (true) {
  delay(1000);
}
