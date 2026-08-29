// 06 — access point (SoftAP). The AP facts (ssid/psk/channel) ride the
// constructor; client enumeration/AP IP have no Zephyr driver hook.
import { WiFiAP, Time } from '@typecad/hal';

const ap = new WiFiAP("cuttlefish-setup", { psk: "config123" });
ap.start();
console.log("AP started");

while (true) {
  console.log("AP running");
  Time.sleep(5000);
}
