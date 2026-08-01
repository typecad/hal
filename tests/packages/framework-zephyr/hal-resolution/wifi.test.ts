import { describe, it, expect } from 'vitest';
import { lowerWifi, wifiInitLines } from '../../../../packages/framework-zephyr/src/lowering/wifi';
import { setActiveChip } from '../../../../packages/framework-zephyr/src/chips/index';
import { ESP32S3_DEVKITC } from '../../../../packages/framework-zephyr/src/chips/esp32s3';

setActiveChip(ESP32S3_DEVKITC);

describe('wifi init shim', () => {
  const shim = wifiInitLines().join('\n');

  it('emits CUTTLEFISH_WIFI markers + the __tc_wifi state struct', () => {
    expect(shim).toContain('// CUTTLEFISH_WIFI_BEGIN');
    expect(shim).toContain('// CUTTLEFISH_WIFI_END');
    expect(shim).toContain('static struct');
    expect(shim).toContain('__tc_wifi');
    expect(shim).toContain('bool connected');
    expect(shim).toContain('bool scanning');
    expect(shim).toContain('scan_results');
  });

  it('registers a net_mgmt handler for L4 connectivity + WiFi scan events', () => {
    expect(shim).toContain('net_mgmt_init_event_handler');
    expect(shim).toContain('NET_EVENT_L4_CONNECTED');
    expect(shim).toContain('NET_EVENT_L4_DISCONNECTED');
    expect(shim).toContain('NET_EVENT_WIFI_SCAN_RESULT');
    expect(shim).toContain('NET_EVENT_WIFI_SCAN_DONE');
  });

  it('uses conn_mgr for connect/disconnect (portability layer)', () => {
    expect(shim).toContain('conn_mgr_if_connect');
    expect(shim).toContain('conn_mgr_if_disconnect');
  });

  it('uses net_mgmt for scan start + radio queries', () => {
    expect(shim).toContain('NET_REQUEST_WIFI_SCAN');
  });
});

describe('wifi lowering — connection ops', () => {
  it('connect → blocking wrapper', () => {
    expect(lowerWifi({ operation: 'wifi.connect', ssid: '"net"', password: '"pw"', timeoutMs: 10000 } as any))
      .toEqual({ code: '__tc_wifi_connect("net", "pw", 10000);' });
  });
  it('connect_start → conn_mgr_if_connect kick', () => {
    expect(lowerWifi({ operation: 'wifi.connect_start', ssid: '"net"', password: '"pw"' } as any))
      .toEqual({ code: '__tc_wifi_connect_start("net", "pw");' });
  });
  it('disconnect → conn_mgr_if_disconnect', () => {
    expect(lowerWifi({ operation: 'wifi.disconnect' } as any))
      .toEqual({ code: '__tc_wifi_disconnect();' });
  });
  it('status → expression', () => {
    expect(lowerWifi({ operation: 'wifi.status' } as any))
      .toEqual({ expression: '__tc_wifi_status()' });
  });
  it('is_connected → connected flag (the async-split poll predicate)', () => {
    expect(lowerWifi({ operation: 'wifi.is_connected' } as any))
      .toEqual({ expression: '(__tc_wifi.connected)' });
  });
  it('local_ip / rssi / mac → expressions', () => {
    expect(lowerWifi({ operation: 'wifi.local_ip' } as any)).toEqual({ expression: '__tc_wifi_local_ip()' });
    expect(lowerWifi({ operation: 'wifi.rssi' } as any)).toEqual({ expression: '__tc_wifi_rssi()' });
    expect(lowerWifi({ operation: 'wifi.mac' } as any)).toEqual({ expression: '__tc_wifi_mac()' });
  });
});

describe('wifi lowering — scan ops', () => {
  it('scan → blocking wrapper', () => {
    expect(lowerWifi({ operation: 'wifi.scan' } as any)).toEqual({ code: '__tc_wifi_scan_blocking();' });
  });
  it('scan_start → net_mgmt kick', () => {
    expect(lowerWifi({ operation: 'wifi.scan_start' } as any)).toEqual({ code: '__tc_wifi_scan_start();' });
  });
  it('scan_done → poll predicate', () => {
    expect(lowerWifi({ operation: 'wifi.scan_done' } as any)).toEqual({ expression: '(!__tc_wifi.scanning)' });
  });
  it('scan_count → expression', () => {
    expect(lowerWifi({ operation: 'wifi.scan_count' } as any)).toEqual({ expression: '((int32_t)__tc_wifi.scan_count)' });
  });
  it('scan_ssid/rssi/encryption/channel → indexed expressions', () => {
    expect(lowerWifi({ operation: 'wifi.scan_ssid', index: 0 } as any)).toEqual({ expression: '__tc_wifi_scan_ssid(0)' });
    expect(lowerWifi({ operation: 'wifi.scan_rssi', index: 1 } as any)).toEqual({ expression: '__tc_wifi_scan_rssi(1)' });
    expect(lowerWifi({ operation: 'wifi.scan_encryption', index: 2 } as any)).toEqual({ expression: '__tc_wifi_scan_enc(2)' });
    expect(lowerWifi({ operation: 'wifi.scan_channel', index: 3 } as any)).toEqual({ expression: '__tc_wifi_scan_channel(3)' });
  });
});

describe('wifi lowering — config ops', () => {
  it('set_hostname → shim call', () => {
    expect(lowerWifi({ operation: 'wifi.set_hostname', name: '"dev"' } as any))
      .toEqual({ code: '__tc_wifi_set_hostname("dev");' });
  });
  it('set_tx_power → shim call', () => {
    expect(lowerWifi({ operation: 'wifi.set_tx_power', dbm: 20 } as any))
      .toEqual({ code: '__tc_wifi_set_tx_power(20);' });
  });
});

describe('wifi lowering — out-of-scope ops return undefined', () => {
  // These are declared unsupported in the manifest; the resolver must NOT lower
  // them (the validator probes this). No AP mode, no credentials, no waits
  // (cuttlefish's async split builds waits from the in-scope connect ops), no
  // deferred config ops.
  const unsupported = [
    'wifi.ap_start', 'wifi.ap_stop', 'wifi.ap_client_count', 'wifi.ap_ip',
    'wifi.ap_set_channel', 'wifi.ap_set_hidden', 'wifi.ap_set_max_clients',
    'wifi.save_credentials', 'wifi.connect_saved', 'wifi.clear_credentials',
    'wifi.wait_connected', 'wifi.wait_disconnected',
    'wifi.set_power_save', 'wifi.set_static_ip', 'wifi.set_auto_reconnect', 'wifi.on_event',
  ];
  for (const op of unsupported) {
    it(`${op} → undefined`, () => {
      expect(lowerWifi({ operation: op } as any)).toBeUndefined();
    });
  }
});
