// 08 — HTTP GET over the WiFi link (the smoke test that WiFi is usable).
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Request, Time, UART0 } from '@typecad/hal';

const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PASSWORD });
wifi.join();

const req = new Request(Request.GET, "http://httpbin.org/get", { timeoutMs: 10000 });
req.send();
UART0.writeLine(`status=${req.status()}`);
UART0.writeLine(req.text());

while (true) {
  Time.sleep(1000);
}
