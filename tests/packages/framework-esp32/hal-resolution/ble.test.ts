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
  });

  it('starts the NimBLE host via nimble_port_run', () => {
    const lines = bleInitLines().join('\n');
    expect(lines).toMatch(/nimble_port_run|nimble_host_task/);
  });

  it('registers a GAP event handler', () => {
    const lines = bleInitLines().join('\n');
    expect(lines).toMatch(/ble_gap_event|gap_event/);
  });

  // C1: 128-bit UUIDs must be stored little-endian (reversed) in ble_uuid128_t.value.
  // The Bluetooth Core Spec transmits 128-bit UUIDs in little-endian byte order and
  // NimBLE's BLE_UUID128_INIT expects bytes reversed relative to the canonical string.
  // Storing left-to-right (string order) silently advertises the wrong UUID, so a
  // central scanning for the UUID the user wrote never finds the characteristic.
  // Regression guard: assert the parser writes into the value array via a reversed
  // index (value[15 - bi]) rather than value[bi++].
  it('parses 128-bit UUIDs into ble_uuid128_t.value in little-endian (reversed) order', () => {
    const lines = bleInitLines().join('\n');
    // The parser must write the first hex pair of the string into the LAST byte slot.
    expect(lines).toContain('value[15 -');
    expect(lines).not.toMatch(/b\[bi\+\+\]\s*=\s*.*strtol/);
  });

  it('uses os_mbuf_copydata to decode write payloads (handles chained mbufs)', () => {
    // M2: reading ctxt->om->om_data directly only works for single-segment mbufs.
    // For correctness across chained mbufs the write path must copy out with
    // os_mbuf_copydata(ctxt->om, 0, len, &dst).
    const lines = bleInitLines().join('\n');
    expect(lines).toContain('os_mbuf_copydata');
    // Must not reach into the mbuf data pointer directly in the write branch.
    expect(lines).not.toContain('ctxt->om->om_data[0]');
  });

  // H1: legacy advertising payloads are capped at 31 bytes. Cramming flags +
  // complete local name + TX power into one packet overflows for any name longer
  // than ~20 chars, and ble_gap_adv_set_fields returns BLE_HS_EMSGSIZE — which the
  // old code ignored, leaving the device silently undiscoverable. The name must go
  // into the scan response, and the return codes of both field-setters must be
  // checked.
  it('moves the complete name to scan response and checks adv field return codes', () => {
    const lines = bleInitLines().join('\n');
    // Capture the advertise_start *definition* (ends with '{'), not the forward
    // declaration (ends with ';'). Take up to the next standalone closing brace.
    const adv = lines.match(/static void __tc_ble_advertise_start\(void\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(adv).toContain('ble_gap_adv_rsp_set_fields');
    // The return code of both field setters must be inspected (not bare statements).
    expect(adv).toMatch(/rc\s*=\s*ble_gap_adv_set_fields/);
    expect(adv).not.toMatch(/^(\s*)ble_gap_adv_set_fields\(&adv\);\s*$/m);
  });

  // L1: __tc_ble_add_char's idx parameter is the characteristic slot. It must not be
  // discarded with (void)idx — on_read/on_write key off current_char (set from the
  // counter), so the idx argument the HAL passes is effectively ignored today.
  it('add_char honors the idx slot argument instead of discarding it', () => {
    const lines = bleInitLines().join('\n');
    // The idx parameter must drive the slot index, not be discarded.
    const addChar = lines.match(/static inline void __tc_ble_add_char\([\s\S]*?^}/m)?.[0] ?? '';
    expect(addChar).not.toContain('(void)idx');
    expect(addChar).toMatch(/idx\s*<\s*0\s*\|\|\s*idx\s*>=\s*__TC_BLE_MAX_CHARS/);
  });

  // ble.notify: was a no-op. The real path is ble_gatts_notify_custom, which needs
  // (conn_handle, val_handle, os_mbuf). val_handle is assigned by NimBLE during
  // service registration, so the shim must capture it from the characteristic
  // table after ble_gatts_add_svcs and key it by char index.
  it('captures each characteristic val_handle after ble_gatts_add_svcs', () => {
    const lines = bleInitLines().join('\n');
    expect(lines).toContain('ble_gatts_add_svcs');
    // After registration, walk the characteristic table and store val_handles
    // so notify can look them up by index.
    expect(lines).toMatch(/val_handle/);
    expect(lines).toMatch(/ble_gatts_chr_val_handles|val_handles\[/);
  });

  it('notify sends via ble_gatts_notify_custom (not a printf no-op)', () => {
    const lines = bleInitLines().join('\n');
    const notify = lines.match(/static inline void __tc_ble_notify\(int idx[\s\S]*?\n\}/)?.[0] ?? '';
    expect(notify).not.toContain('not yet implemented');
    expect(notify).toContain('ble_gatts_notify_custom');
    // Must guard against no active connection / invalid index.
    expect(notify).toMatch(/conn_handle\s*<\s*0|__tc_ble\.conn_handle\s*<\s*0/);
  });

  // ble.set_tx_power: was a no-op. The runtime path is esp_ble_tx_power_set on the
  // DEFAULT power type, applied after the controller is up. The requested dBm is
  // stashed (like the WiFi tx-power stash) and applied after nimble_port_init.
  it('applies BLE TX power via esp_ble_tx_power_set after stack init', () => {
    const lines = bleInitLines().join('\n');
    expect(lines).toContain('esp_ble_tx_power_set');
    // A stash field holds the requested dBm so set_tx_power before begin() still
    // applies once the controller is up.
    expect(lines).toMatch(/tx_power_dbm|pending_tx_power/);
    // The set_tx_power shim must not be a bare no-op.
    const setTx = lines.match(/static inline void __tc_ble_set_tx_power\(int dbm\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(setTx).not.toMatch(/\(void\)dbm;\s*\}/);
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
    expect(lowerBle({ operation: 'ble.add_char', index: 0, uuid: '"2A6E"', type: '"int16"', perms: 5, svcIndex: 0 }))
      .toEqual({ code: '__tc_ble_add_char(0, "2A6E", "int16", 5, 0);' });
  });

  it('add_char defaults svcIndex to 0 when omitted', () => {
    expect(lowerBle({ operation: 'ble.add_char', index: 1, uuid: '"2A6F"', type: '"uint16"', perms: 1 } as any))
      .toEqual({ code: '__tc_ble_add_char(1, "2A6F", "uint16", 1, 0);' });
  });
});

describe('ble lowering — callbacks', () => {
  it('on_read → assigns function pointer via current_char', () => {
    expect(lowerBle({ operation: 'ble.on_read', index: 0, handler: 'main_isr_3' }))
      .toEqual({ code: '__tc_ble.on_read[__tc_ble.current_char] = (void*)(main_isr_3);' });
  });

  it('on_write → assigns function pointer via current_char', () => {
    expect(lowerBle({ operation: 'ble.on_write', index: 1, handler: 'main_isr_4' }))
      .toEqual({ code: '__tc_ble.on_write[__tc_ble.current_char] = (main_isr_4);' });
  });
});

describe('ble lowering — notify / status queries', () => {
  it('notify → __tc_ble_notify(current_char, value) expression', () => {
    expect(lowerBle({ operation: 'ble.notify', index: 0, value: 42 }))
      .toEqual({ expression: '__tc_ble_notify(__tc_ble.current_char, 42)' });
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
