// 03 — async/await: cooperative connect while the heartbeat keeps running.
// Each async function becomes a state-machine task driven from loop(). The
// awaited WiFi calls lower to start + poll states (no blocking waits), so the
// LED keeps blinking while WiFi.connect() waits for the link.
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, delay } from '@typecad/hal';
import { D2 } from '@typecad/board-esp32-devkit';

const led = D2.asOutput();

// Linear task: connect once, print the IP, done.
async function network() {
  await WiFi.connect(WIFI_SSID, WIFI_PASSWORD, 30000);
  console.log(WiFi.localIP());
}

// Cyclic task: watch the link and log drops/recoveries forever.
async function watchLink() {
  while (true) {
    await WiFi.untilDisconnected();
    console.log("link lost");
    await WiFi.untilConnected(0);
    console.log("link restored");
  }
}

async function heartbeat() {
  while (true) {
    led.toggle();
    await delay(500);
  }
}

network();
watchLink();
heartbeat();
