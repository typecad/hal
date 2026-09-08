// ---------------------------------------------------------------------------
// file-mqtt.test.ts — thin File + Mqtt on hardware (ESP32-S3 devkitC)
//
// File: littlefs round-trip on the board's storage partition — write, read
// back, exists, remove, and a cross-flash marker (files live in the same
// partition as the settings store, so they survive re-flashing the app).
// Firmware-side string compares (no .length on const char*).
//
// Mqtt: pub/sub against the LAN test server's Aedes broker (start-server.ts,
// mqtt://192.168.2.184:1883 — no TLS). WiFi joins Skynet first; then
// connect → subscribe → publish → expect the message to loop back through
// onMessage (Aedes echoes PUBLISH back to subscribers, including the sender
// when subscribed).
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/hal/testing';
import { WiFi, File, Mqtt, Time } from '@typecad/hal';

// ── File (littlefs on the storage partition) ──────────────────────────────

const notes = new File('/notes.txt');

// Read the previous flash's marker BEFORE overwriting it; compare against
// the known sentinel content (firmware-side compare — no string methods on
// const char* shims).
const prevMarkerFile = new File('/marker.txt');
const prevMarker = prevMarkerFile.read();
const markerWasThere = prevMarker === 'typecad-hal-3141' ? 1 : 0;

notes.write('typecad-hal-was-here');

describe('thin file — littlefs round-trip')
  .it('write → read returns the content')
    .expect(notes.read() === 'typecad-hal-was-here' ? 1 : 0).toBe(1)
  .it('exists() is true after write')
    .expect(notes.exists() ? 1 : 0).toBe(1)
  .it('remove() deletes (exists goes false)')
    .expect((() => { notes.remove(); return notes.exists() ? 1 : 0; })()).toBe(0)
  .it('cross-flash marker read before overwrite')
    .expect(markerWasThere).toBe(1);

new File('/marker.txt').write('typecad-hal-3141');

// ── Mqtt (Aedes broker on the test server) ────────────────────────────────

const wifi = new WiFi('Skynet', { psk: 'justin04', timeoutMs: 25000 });
wifi.join();

const mqtt = new Mqtt('mqtt://192.168.2.184:1883', { clientId: 's3-rig' });

let received = 0;
let topicOk = 0;
function onMsg(topic: string, payload: string): void {
  if (topic === 'rig/echo') topicOk = 1;
  if (payload === 'ping-from-s3') received = 1;
}

// connect() runs at top level — never inside an expect IIFE — so the
// shim's error printks (DNS/CONNACK-timeout) can't race a protocol line.
// Retry connect() until the session is up — right after join() the
// resolver may not be provisioned yet (DNS EAI_FAIL on the first beat).
mqtt.onMessage(onMsg);
for (let i = 0; i < 12; i = i + 1) {
  mqtt.connect();
  for (let j = 0; j < 8; j = j + 1) { Time.sleep(250); if (mqtt.linked()) break; }
  if (mqtt.linked()) break;
}
mqtt.subscribe('rig/echo');
Time.sleep(500);
mqtt.publish('rig/echo', 'ping-from-s3');
for (let i = 0; i < 40; i = i + 1) { Time.sleep(250); if (received === 1) break; }

describe('thin mqtt — pub/sub vs the LAN broker')
  .it('connect() established the session')
    .expect(mqtt.linked() ? 1 : 0).toBe(1)
  .it('publish looped back through onMessage')
    .expect(received + topicOk * 2).toBe(3);

mqtt.disconnect();

done();
