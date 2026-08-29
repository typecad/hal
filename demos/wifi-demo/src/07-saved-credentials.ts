// 07 — AP fallback (provisioning-lite). Zephyr has no HAL-side saved-
// credential layer; this shows the station-join + AP-fallback pattern.
// Persist credentials via Zephyr settings subsystem outside the HAL if needed.
import { WiFi, WiFiAP, Time } from '@typecad/hal';

const wifi = new WiFi("HomeNet", { psk: "hunter22", timeoutMs: 15000 });

if (!wifi.join()) {
  // Station join failed — fall back to a setup AP so the operator can
  // provision real credentials out-of-band.
  const setup = new WiFiAP("device-setup");
  setup.start();
  console.log("AP fallback started");
} else {
  console.log(wifi.ip());
}

while (true) {
  Time.sleep(1000);
}
