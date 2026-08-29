// 02 — configured join: security/band/channel/timeout facts (the link policy
// rides the constructor; hostname/tx-power/auto-reconnect have no Zephyr
// lowering — static IPv4 does, as the ipv4 fact).
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Time } from '@typecad/hal';

const wifi = new WiFi(WIFI_SSID, {
  psk: WIFI_PASSWORD,
  security: WiFi.WPA2,
  channel: 6,
  timeoutMs: 30000,
  powerSave: WiFi.PS_OFF,
});

if (!wifi.join()) {
  console.error("join failed");
} else {
  console.log(wifi.ip());
  console.log(wifi.mac());
  console.log(wifi.rssi());
}

while (true) {
  Time.sleep(1000);
}
