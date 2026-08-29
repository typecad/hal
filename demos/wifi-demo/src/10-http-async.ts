// 10 — cooperative HTTP polling while the heartbeat keeps running.
// Request.send() awaited lowers to a start + poll state pair: the request runs on a
// short-lived worker task while the state machine polls for completion, so
// the heartbeat never stalls during a slow request.
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Request, Time, GPIO } from '@typecad/hal';

const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PASSWORD });
import { GPIO2 as D2 } from '@typecad/board';

const led = new GPIO(D2, GPIO.OUTPUT);

// Linear task: bring the link up.
// Staged join (see 03's note on the awaited-instance-method limitation).
wifi.joinStart();

async function network() {
  while (!wifi.linked()) { await Time.sleep(100); }
  console.log(wifi.ip());
}

// Cyclic task: poll the endpoint every 5 s once the link is up.
async function pollCloud() {
  while (true) {
    while (!wifi.linked()) { await Time.sleep(250); }
    const req = new Request(Request.GET, "https://httpbin.org/get");
    await req.send();
    console.log(`${req.status()}`);
    await Time.sleep(5000);
  }
}

async function heartbeat() {
  while (true) {
    led.toggle();
    await Time.sleep(500);
  }
}

network();
pollCloud();
heartbeat();
