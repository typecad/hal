// 03 — async/await: cooperative connect while the heartbeat keeps running.
// Each async function becomes a state-machine task driven from loop(). The
// awaited WiFi calls lower to start + poll states (no blocking waits), so the
// LED keeps blinking while WiFi.connect() waits for the link.
const WIFI_SSID = "Skynet";
const WIFI_PASSWORD = "justin04";

import { WiFi, delay, Http } from '@typecad/hal';
WiFi.txPower(10);

WiFi.connect(WIFI_SSID, WIFI_PASSWORD);

const req = Http.get("https://webhook.site/85434668-ea2e-4e9e-a5b7-73dd529234a6");
req.timeout(10000);
req.send();
console.log(`status=${req.status()}`);
console.log(req.text());

while (true) {
  delay(1000);
}