// 05 — network scanner: one blocking scan, results through the handle.
import { WiFi, Time } from '@typecad/hal';

const wifi = new WiFi("any");
const scan = wifi.scan();

console.log(`found ${scan.count()} networks`);
for (let i = 0; i < scan.count(); i++) {
  console.log(`${scan.ssid(i)}  ${scan.rssi(i)} dBm  ch${scan.channel(i)}  enc=${scan.security(i)}`);
}

while (true) {
  Time.sleep(1000);
}
