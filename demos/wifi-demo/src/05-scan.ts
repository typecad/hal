// 05 — network scanner: blocking scan at top level.
import { WiFi, delay } from '@typecad/hal';

const n = WiFi.scan();
console.log(`found ${n} networks`);
for (let i = 0; i < n; i++) {
  console.log(`${WiFi.scanSSID(i)}  ${WiFi.scanRSSI(i)} dBm  ch${WiFi.scanChannel(i)}  enc=${WiFi.scanEncryption(i)}`);
}

while (true) {
  delay(1000);
}
