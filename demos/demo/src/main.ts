// 04 — event-callback style: no async functions, no blocking connect.
const WIFI_SSID = "Skynet";
const WIFI_PASSWORD = "justin04";

import { WiFi, delay, setInterval } from '@typecad/hal';

WiFi.onConnect(() => {
  console.log("online");
});

WiFi.onDisconnect(() => {
  console.log("link lost, auto-reconnecting");
  WiFi.connectAsync(WIFI_SSID, WIFI_PASSWORD);
});

WiFi.connectAsync(WIFI_SSID, WIFI_PASSWORD);

setInterval(() => (WiFi.disconnect()), 30000);

while (true) {
  if (WiFi.isConnected()) {
    // do connected work here
  }
  delay(250);
}
