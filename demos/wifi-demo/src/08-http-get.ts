// 08 — HTTP GET over the WiFi link (the smoke test that WiFi is usable).
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Http, delay } from '@typecad/hal';

WiFi.connect(WIFI_SSID, WIFI_PASSWORD);

const req = Http.get("http://httpbin.org/get");
req.timeout(10000);
req.send();
console.log(`status=${req.status()}`);
console.log(req.text());

while (true) {
  delay(1000);
}
