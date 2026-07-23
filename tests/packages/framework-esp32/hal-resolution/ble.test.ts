import { describe, it, expect } from 'vitest';
import { lowerBle, bleInitLines } from '../../../../packages/framework-esp32/src/lowering/ble';

describe('ble init block', () => {
  it('emits CUTTLEFISH_BLE markers', () => {
    const lines = bleInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_BLE_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_BLE_END');
  });

  it('declares the __tc_ble state struct with handler arrays', () => {
    const lines = bleInitLines().join('\n');
    expect(lines).toContain('__TC_BLE_MAX_CHARS');
    expect(lines).toContain('on_read');
    expect(lines).toContain('on_write');
    expect(lines).toContain('on_subscribe');
  });

  it('starts the NimBLE host task from ensure_init', () => {
    const lines = bleInitLines().join('\n');
    expect(lines).toMatch(/nimble_host_task|ble_hs_start/);
  });

  it('registers a GAP event handler', () => {
    const lines = bleInitLines().join('\n');
    expect(lines).toMatch(/ble_gap_event|gap_event/);
  });
});

describe('ble lowering — server / advertise lifecycle', () => {
  it('server_begin → __tc_ble_server_begin(name); statement', () => {
    expect(lowerBle({ operation: 'ble.server_begin', name: '"TempSensor"' }))
      .toEqual({ code: '__tc_ble_server_begin("TempSensor");' });
  });

  it('advertise_start → __tc_ble_advertise_start(); statement', () => {
    expect(lowerBle({ operation: 'ble.advertise_start' }))
      .toEqual({ code: '__tc_ble_advertise_start();' });
  });

  it('advertise_stop → __tc_ble_advertise_stop(); statement', () => {
    expect(lowerBle({ operation: 'ble.advertise_stop' }))
      .toEqual({ code: '__tc_ble_advertise_stop();' });
  });
});

describe('ble lowering — service / characteristic graph', () => {
  it('add_service → __tc_ble_add_service(uuid); statement', () => {
    expect(lowerBle({ operation: 'ble.add_service', uuid: '"181A"' }))
      .toEqual({ code: '__tc_ble_add_service("181A");' });
  });

  it('add_char → __tc_ble_add_char(index, uuid, type, perms, svcIndex); statement', () => {
    expect(lowerBle({ operation: 'ble.add_char', index: 0, uuid: '"2A6E"', type: '"int16"', perms: '5', svcIndex: 0 }))
      .toEqual({ code: '__tc_ble_add_char(0, "2A6E", "int16", 5, 0);' });
  });

  it('add_char defaults svcIndex to 0 when omitted', () => {
    expect(lowerBle({ operation: 'ble.add_char', index: 1, uuid: '"2A6F"', type: '"uint16"', perms: '1' } as any))
      .toEqual({ code: '__tc_ble_add_char(1, "2A6F", "uint16", 1, 0);' });
  });
});

describe('ble lowering — callbacks', () => {
  it('on_read → assigns function pointer to handler slot', () => {
    expect(lowerBle({ operation: 'ble.on_read', index: 0, handler: 'main_isr_3' }))
      .toEqual({ code: '__tc_ble.on_read[0] = &main_isr_3;' });
  });

  it('on_write → assigns function pointer to handler slot', () => {
    expect(lowerBle({ operation: 'ble.on_write', index: 1, handler: 'main_isr_4' }))
      .toEqual({ code: '__tc_ble.on_write[1] = &main_isr_4;' });
  });

  it('on_subscribe → assigns function pointer to handler slot', () => {
    expect(lowerBle({ operation: 'ble.on_subscribe', index: 0, handler: 'main_isr_5' }))
      .toEqual({ code: '__tc_ble.on_subscribe[0] = &main_isr_5;' });
  });
});

describe('ble lowering — notify / status queries', () => {
  it('notify → __tc_ble_notify(index, value) expression', () => {
    expect(lowerBle({ operation: 'ble.notify', index: 0, value: 42 }))
      .toEqual({ expression: '__tc_ble_notify(0, 42)' });
  });

  it('is_connected → __tc_ble_is_connected() expression', () => {
    expect(lowerBle({ operation: 'ble.is_connected' }))
      .toEqual({ expression: '__tc_ble_is_connected()' });
  });

  it('client_count → __tc_ble_client_count() expression', () => {
    expect(lowerBle({ operation: 'ble.client_count' }))
      .toEqual({ expression: '__tc_ble_client_count()' });
  });

  it('status → __tc_ble.status expression', () => {
    expect(lowerBle({ operation: 'ble.status' }))
      .toEqual({ expression: '__tc_ble.status' });
  });

  it('set_name → __tc_ble_set_name(name); statement', () => {
    expect(lowerBle({ operation: 'ble.set_name', name: '"MyDevice"' }))
      .toEqual({ code: '__tc_ble_set_name("MyDevice");' });
  });

  it('set_tx_power → __tc_ble_set_tx_power(dbm); statement', () => {
    expect(lowerBle({ operation: 'ble.set_tx_power', dbm: 9 }))
      .toEqual({ code: '__tc_ble_set_tx_power(9);' });
  });
});

describe('ble lowering — async connect triple', () => {
  it('until_connected (blocking) → __tc_ble_until_connected(timeout) expression', () => {
    expect(lowerBle({ operation: 'ble.until_connected', timeoutMs: 30000, blocking: true }))
      .toEqual({ expression: '__tc_ble_until_connected(30000)' });
  });

  it('until_connected defaults timeout to 0 (wait forever)', () => {
    expect(lowerBle({ operation: 'ble.until_connected', timeoutMs: 0, blocking: true } as any))
      .toEqual({ expression: '__tc_ble_until_connected(0)' });
  });

  it('until_connected_start → __tc_ble_until_connected_start(); statement', () => {
    expect(lowerBle({ operation: 'ble.until_connected_start' }))
      .toEqual({ code: '__tc_ble_until_connected_start();' });
  });
});

describe('ble lowering — error handling', () => {
  it('unknown ble.* op throws', () => {
    expect(() => lowerBle({ operation: 'ble.unknown' } as any)).toThrow(/does not yet support/);
  });
});
