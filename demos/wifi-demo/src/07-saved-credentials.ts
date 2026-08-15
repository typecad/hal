// 07 — AP fallback (provisioning-lite). Zephyr has no NVS-saved credential
// layer in the HAL (connectSaved/saveCredentials are unsupported); this demo
// shows the equivalent pattern with a hardcoded SSID and AP fallback when the
// station connect fails. Persist credentials via Zephyr settings subsystem
// outside the HAL if needed.
import { WiFi, delay } from '@typecad/hal';

const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

if (!WiFi.connect(WIFI_SSID, WIFI_PASSWORD, 15000)) {
  // Station connect failed — fall back to a setup AP so the operator can
  // provision real credentials out-of-band.
  WiFi.startAP("device-setup");
  console.log("AP fallback started");
} else {
  console.log(WiFi.localIP());
}

while (true) {
  delay(1000);
}
