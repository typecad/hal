// 05 — network scanner: one blocking scan, results through the handle.
import { WiFi, Time } from '@typecad/hal';
import { UART0 } from '@typecad/board';

const wifi = new WiFi("any");
const scan = wifi.scan();

UART0.writeLine(`found ${scan.count()} networks`);
for (let i = 0; i < scan.count(); i++) {
  UART0.writeLine(`${scan.ssid(i)}  ${scan.rssi(i)} dBm  ch${scan.channel(i)}  enc=${scan.security(i)}`);
}

while (true) {
  Time.sleep(1000);
}
