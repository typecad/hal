// 03 — async/await: cooperative connect while the heartbeat keeps running.
// Each async function becomes a state-machine task driven from loop(). The
// awaited WiFi calls lower to start + poll states (no blocking waits), so the
// LED keeps blinking while WiFi.connect() waits for the link.
const WIFI_SSID = "Skynet";
const WIFI_PASSWORD = "justin04";

import { WiFi, delay, Http, setInterval } from '@typecad/hal';
WiFi.txPower(10);

WiFi.apChannel(6).apMaxClients(4);
WiFi.startAP("cuttlefish-setup", "config123");
console.log(WiFi.apIP());

while (true) {
  console.log(`clients: ${WiFi.apClientCount()}`);
  delay(5000);
}