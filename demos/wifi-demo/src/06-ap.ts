// 06 — access point (SoftAP). The AP facts (ssid/psk/channel) ride the
// constructor; client enumeration/AP IP have no Zephyr driver hook.
import { WiFiAP, Time } from '@typecad/hal';
import { UART0 } from '@typecad/board';

const ap = new WiFiAP("cuttlefish-setup", { psk: "config123" });
ap.start();
UART0.writeLine("AP started");

while (true) {
  UART0.writeLine("AP running");
  Time.sleep(5000);
}
