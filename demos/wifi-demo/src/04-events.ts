// 04 — event-callback style: no async functions, no blocking join.
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Time } from '@typecad/hal';

const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PASSWORD });

wifi.onUp(() => {
  console.log("online");
});
wifi.onDrop(() => {
  console.log("link lost");
});

wifi.joinStart();

while (true) {
  if (wifi.linked()) {
    // do connected work here
  }
  Time.sleep(250);
}
