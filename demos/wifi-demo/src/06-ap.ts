// 06 — access point (SoftAP). Zephyr supports startAP/stopAP but not the
// fine-grained AP options (channel, max clients, client count, AP IP) — those
// are configured via devicetree / net_mgmt on Zephyr, not the HAL surface.
import { WiFi, delay } from '@typecad/hal';

WiFi.startAP("cuttlefish-setup", "config123");
console.log("AP started");

while (true) {
  console.log("AP running");
  delay(5000);
}
