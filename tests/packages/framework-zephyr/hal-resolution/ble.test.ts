import { describe, it, expect } from 'vitest';
import { lowerBle, bleInitLines } from '../../../../packages/framework-zephyr/src/lowering/ble';

describe('ble init shim', () => {
  const shim = bleInitLines().join('\n');

  it('emits CUTTLEFISH_BLE markers + the bt_* state structs', () => {
    expect(shim).toContain('// CUTTLEFISH_BLE_BEGIN');
    expect(shim).toContain('// CUTTLEFISH_BLE_END');
    expect(shim).toContain('bt_gatt_service_register');
    expect(shim).toContain('bt_enable(NULL)');
    expect(shim).toContain('bt_le_adv_start(BT_LE_ADV_CONN_FAST_1');
  });

  // Q2 regression: the emitted shim bytes must use C++ named casts (not
  // C-style casts) so they pass --autosar=strict.
  it('uses static_cast/reinterpret_cast (no C-style casts) for AUTOSAR compliance', () => {
    // The on_read handler assignment must use reinterpret_cast, not (void*).
    expect(shim).toContain('reinterpret_cast<void*>');
    expect(shim).not.toMatch(/[^a-z_]on_read\[__tc_ble\.current_char\] = \(void\*\)/);
    // The attr table user_data must use named casts.
    expect(shim).toContain('reinterpret_cast<void*>(static_cast<intptr_t>(c))');
    expect(shim).not.toContain('(void*)(intptr_t)c');
    // uuid storage must use const_cast + static_cast, not (void*).
    expect(shim).toContain('static_cast<void*>(const_cast<struct bt_uuid*>');
    expect(shim).not.toContain('(void*)__tc_ble_make_svc_uuid');
    // the read dispatcher must cast via reinterpret_cast, not C-style fn casts.
    expect(shim).toContain('reinterpret_cast<const char*(*)(void)>');
    expect(shim).toContain('reinterpret_cast<double(*)(void)>');
    expect(shim).toContain('reinterpret_cast<int(*)(void)>');
  });
});

describe('ble lowering', () => {
  it('server_begin calls the shim with the name', () => {
    expect(lowerBle({ operation: 'ble.server_begin', name: '"MyDev"' } as any))
      .toEqual({ code: '__tc_ble_server_begin("MyDev");' });
  });

  it('advertise_start / stop → shim calls', () => {
    expect(lowerBle({ operation: 'ble.advertise_start' } as any))
      .toEqual({ code: '__tc_ble_advertise_start();' });
    expect(lowerBle({ operation: 'ble.advertise_stop' } as any))
      .toEqual({ code: '__tc_ble_advertise_stop();' });
  });

  it('add_service passes the uuid', () => {
    expect(lowerBle({ operation: 'ble.add_service', uuid: '"181A"' } as any))
      .toEqual({ code: '__tc_ble_add_service("181A");' });
  });

  it('add_char passes index/uuid/type/perms/svcIndex', () => {
    const out = lowerBle({ operation: 'ble.add_char', index: 0, uuid: '"2A6E"', type: '"int16"', perms: 5, svcIndex: 0 } as any);
    expect(out.code).toBe('__tc_ble_add_char(0, "2A6E", "int16", 5, 0);');
  });

  it('on_read stores the handler via reinterpret_cast', () => {
    const out = lowerBle({ operation: 'ble.on_read', handler: 'myRead' } as any);
    expect(out.code).toBe('__tc_ble.on_read[__tc_ble.current_char] = reinterpret_cast<void*>(myRead);');
  });

  it('is_connected / client_count / status → expressions', () => {
    expect(lowerBle({ operation: 'ble.is_connected' } as any)).toEqual({ expression: '__tc_ble_is_connected()' });
    expect(lowerBle({ operation: 'ble.client_count' } as any)).toEqual({ expression: '__tc_ble_client_count()' });
    expect(lowerBle({ operation: 'ble.status' } as any)).toEqual({ expression: '__tc_ble.status' });
  });
});
