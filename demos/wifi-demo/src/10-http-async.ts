// 10 — cooperative HTTP polling while the heartbeat keeps running.
// Http.send() lowers to a start + poll state pair: the request runs on a
// short-lived worker task while the state machine polls for completion, so
// the heartbeat never stalls during a slow request.
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Http, delay } from '@typecad/hal';
import { D2 } from '@typecad/board-esp32-devkit';

const led = D2.asOutput();

// Linear task: bring the link up.
async function network() {
  await WiFi.connect(WIFI_SSID, WIFI_PASSWORD);
  console.log(WiFi.localIP());
}

// Cyclic task: poll the endpoint every 5 s once the link is up.
async function pollCloud() {
  while (true) {
    await WiFi.untilConnected(0);
    const req = Http.get("https://httpbin.org/get");
    await req.send();
    console.log(`${req.status()}`);
    await delay(5000);
  }
}

async function heartbeat() {
  while (true) {
    led.toggle();
    await delay(500);
  }
}

network();
pollCloud();
heartbeat();
