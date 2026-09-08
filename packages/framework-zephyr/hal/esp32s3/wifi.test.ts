// ---------------------------------------------------------------------------
// wifi.test.ts — thin WiFi station/scan on hardware (ESP32-S3 devkitC)
//
// Exercises the fact-carrying WiFi class against a real network:
//   join() associates from the construction facts (SSID/psk/security
//   defaulting) and bounded-waits on the L4 flag; linked()/ip()/rssi()/mac()
//   read the iface state; scan() fills the fixed pool and the handle reads
//   it; leave() drops the link. The rig's console rides the CH34x bridge.
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/hal/testing';
import { WiFi } from '@typecad/hal';

const wifi = new WiFi('Skynet', { psk: 'justin04', timeoutMs: 25000 });

console.log('wifi: joining Skynet ...');

describe('thin wifi station (esp32s3)')
  .it('join() associates and gains IP connectivity')
    .expect(wifi.join()).toBeTruthy()
  .it('linked() agrees with the join result')
    .expect(wifi.linked()).toBeTruthy()
  .it('ip() reports a non-zero address')
    .expect(wifi.ip()).toNotBe('0.0.0.0')
  .it('rssi() reads a sane signal level')
    .expect(wifi.rssi()).toBeGreaterThan(-100)
  .it('mac() reads the associated BSSID as a nonzero number')
    .expect(wifi.mac()).toBeGreaterThan(0);

console.log('wifi: ip=' + wifi.ip() + ' rssi=' + wifi.rssi() + 'dBm');

const scan = wifi.scan();

let found = -1;
for (let i = 0; i < scan.count(); i = i + 1) {
  if (scan.ssid(i) === 'Skynet') { found = i; }
}

describe('thin wifi scan (esp32s3)')
  .it('scan() finds networks in range')
    .expect(scan.count()).toBeGreaterThan(0)
  .it('the scan list contains Skynet')
    .expect(found > -1).toBeTruthy()
  .it('Skynet own rssi is sane')
    .expect(scan.rssi(found)).toBeGreaterThan(-100);

console.log('wifi: scan found ' + scan.count() + ' networks');

wifi.leave();

describe('thin wifi leave (esp32s3)')
  .it('leave() drops the link')
    .expect(wifi.linked()).toBeFalsy();

done();
