// 09 — HTTPS GET + JSON POST (TLS via the pinned CA or the cert bundle).
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Request, Time } from '@typecad/hal';
import { UART0 } from '@typecad/board';

const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PASSWORD });
wifi.join();

const get = new Request(Request.GET, "https://httpbin.org/get");
get.header("X-Device", "cuttlefish");
get.send();
UART0.writeLine(get.status());

const post = new Request(Request.POST, "https://httpbin.org/post", {
  body: `{"temp":21.5,"rssi":${wifi.rssi()}}`,
  json: true,
});
post.send();
UART0.writeLine(post.text());

while (true) {
  Time.sleep(1000);
}
