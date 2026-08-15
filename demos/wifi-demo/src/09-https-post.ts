// 09 — HTTPS GET + JSON POST (TLS via the ESP x509 certificate bundle).
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Http, delay } from '@typecad/hal';

WiFi.connect(WIFI_SSID, WIFI_PASSWORD);

const get = Http.get("https://httpbin.org/get");
get.header("X-Device", "cuttlefish");
get.send();
console.log(get.status());

const post = Http.post("https://httpbin.org/post");
post.jsonBody(`{"temp":21.5,"rssi":${WiFi.rssi()}}`);
post.send();
console.log(post.text());

while (true) {
  delay(1000);
}
