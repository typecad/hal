// 04 — event-callback style: no async functions, no blocking join.
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Time, UART0 } from '@typecad/hal';

const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PASSWORD });

wifi.onUp(() => {
  UART0.writeLine("online");
});
wifi.onDrop(() => {
  UART0.writeLine("link lost");
});

wifi.joinStart();

while (true) {
  if (wifi.linked()) {
    // do connected work here
  }
  Time.sleep(250);
}
