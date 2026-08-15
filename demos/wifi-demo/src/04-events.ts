// 04 — event-callback style: no async functions, no blocking connect.
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, delay } from '@typecad/hal';

WiFi.onGotIP(() => {
  console.log("online");
});
WiFi.onDisconnect(() => {
  console.log("link lost, auto-reconnecting");
});

WiFi.connectAsync(WIFI_SSID, WIFI_PASSWORD);

while (true) {
  if (WiFi.isConnected()) {
    // do connected work here
  }
  delay(250);
}
