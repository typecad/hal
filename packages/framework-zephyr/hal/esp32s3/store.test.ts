// ---------------------------------------------------------------------------
// store.test.ts — thin Store on hardware (ESP32-S3 devkitC)
//
// Exercises the persistent key/value round-trip through the real
// settings/ZMS backend: typed puts land in the storage partition, gets read
// back through the same cache path a reboot would use, remove deletes, and
// a marker key written on a previous flash is read BEFORE this run's writes
// (proving cross-flash persistence — ZMS owns the storage partition, not
// the app image).
//
// (The thin USBConsole can't be exercised on this board: the S3's test
// console rides the USB-Serial-JTAG circuit, not the CDC-ACM device the
// usb.* ops compose. The CDC path is covered by the blackpill rig.)
// ---------------------------------------------------------------------------

import { describe, done } from '@typecad/hal/testing';
import { Store } from '@typecad/hal';

const store = new Store('rig');

// Read the previous flash's marker BEFORE overwriting it.
const prevMarker: number = store.getInt('marker', -1);


store.setInt('bootCount', store.getInt('bootCount', 0) + 1);
store.setFloat('gain', 1.25);
store.setBool('provisioned', true);
store.setString('lastRun', 'flash-b');

describe('thin store — typed round-trip (settings/ZMS)')
  .it('int round-trips (bootCount increments across flashes)')
    .expect(store.getInt('bootCount', 0) > 0 ? 1 : 0).toBe(1)
  .it('float round-trips')
    .expect(store.getFloat('gain', 0)).toBeCloseTo(1.25)
  .it('bool round-trips')
    .expect(store.getBool('provisioned', false) === true ? 1 : 0).toBe(1)
  .it('string round-trips')
    .expect(store.getString('lastRun', '') === 'flash-b' ? 1 : 0).toBe(1)
  .it('remove deletes the key (default comes back)')
    .expect((() => { store.remove('gain'); return store.getFloat('gain', -1); })()).toBe(-1);

describe('thin store — cross-flash persistence')
  .it('marker from the previous flash survived re-flashing the app')
    .expect(prevMarker >= 2000 ? 1 : 0).toBe(1);

store.setInt('marker', 2000 + (prevMarker + 1));

done();
