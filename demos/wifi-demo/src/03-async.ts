// 03 — async/await: cooperative join while the heartbeat keeps running.
// Each async function becomes a state-machine task driven from loop(). The
// awaited join splits into start + poll states (no blocking waits), so the
// LED keeps blinking while the station associates.
const WIFI_SSID = "HomeNet";
const WIFI_PASSWORD = "hunter22";

import { WiFi, Time, GPIO } from '@typecad/hal';
import { GPIO2 as D2, UART0 } from '@typecad/board';

const led = new GPIO(D2, GPIO.OUTPUT);
const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PASSWORD, timeoutMs: 30000 });

// Stage the join at top level (start + poll), then await the link
// cooperatively — the LED keeps beating while the station associates.
wifi.joinStart();

// Linear task: wait for the link, print the IP, done.
async function network() {
  while (!wifi.linked()) { await Time.sleep(100); }
  UART0.writeLine(wifi.ip());
}

// Cyclic task: watch the link and log drops/recoveries forever (poll form —
// the thin API has no wait verbs; onDrop/onUp are the event-driven path).
async function watchLink() {
  let wasUp = false;
  while (true) {
    const up = wifi.linked();
    if (wasUp && !up) UART0.writeLine("link lost");
    if (!wasUp && up) UART0.writeLine("link restored");
    wasUp = up;
    await Time.sleep(250);
  }
}

// The heartbeat toggles the LED — HAL-op statements before an await lower
// cleanly inside the async state machine (this used to render malformed).
async function heartbeat() {
  while (true) {
    led.toggle();
    await Time.sleep(500);
  }
}

network();
watchLink();
heartbeat();
