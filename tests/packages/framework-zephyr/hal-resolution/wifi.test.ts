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
    expect(shim).toContain('net_mgmt_init_event_callback');
    expect(shim).toContain('NET_EVENT_L4_CONNECTED');
    expect(shim).toContain('NET_EVENT_L4_DISCONNECTED');
    expect(shim).toContain('NET_EVENT_WIFI_SCAN_RESULT');
    expect(shim).toContain('NET_EVENT_WIFI_SCAN_DONE');
  });

  it('registers an IPv4-addr handler + fires on_disconnect/on_connect callbacks', () => {
    // wifi.on_event: on_disconnect ← NET_EVENT_L4_DISCONNECTED,
    // on_connect ← NET_EVENT_IPV4_ADDR_ADD (DHCP).
    expect(shim).toContain('NET_EVENT_IPV4_ADDR_ADD');
    expect(shim).toContain('__tc_wifi_cb_t');
    expect(shim).toContain('on_disconnect');
    expect(shim).toContain('on_connect');
    // The handler fires the callbacks (null-checked).
    expect(shim).toContain('if (__tc_wifi.on_disconnect != nullptr) __tc_wifi.on_disconnect();');
    expect(shim).toContain('if (__tc_wifi.on_connect != nullptr) __tc_wifi.on_connect();');
  });

  it('connects/disconnects via net_mgmt (conn_mgr monitor supplies L4 events)', () => {
    expect(shim).toContain('net_if_up');
    expect(shim).toContain('NET_REQUEST_WIFI_CONNECT');
    expect(shim).toContain('NET_REQUEST_WIFI_DISCONNECT');
  });

  it('uses net_mgmt for scan start + radio queries', () => {
    expect(shim).toContain('NET_REQUEST_WIFI_SCAN');
  });

  it('does NOT emit a tx-power helper (removed — driver owns the radio)', () => {
    // wifi.set_tx_power is intentionally not lowered: the Zephyr esp32 driver
    // owns esp_wifi_start/connect, and the ESP-IDF PHY ceiling isn't a Zephyr
    // Kconfig symbol (zephyr#45580). The shim must not call esp_wifi_* directly.
    // (Assert no helper/call symbols; the explanatory comment may name them.)
    expect(shim).not.toContain('static void __tc_wifi_set_tx_power');
    expect(shim).not.toContain('esp_wifi_set_max_tx_power(');
    expect(shim).not.toContain('esp_wifi_start(');
    expect(shim).not.toContain('tx_power_dbm');
  });

  it('emits power-save + AP-mode + wait helpers', () => {
    // set_power_save → real net_mgmt PS_CONFIG request.
    expect(shim).toContain('__tc_wifi_set_power_save');
    expect(shim).toContain('NET_REQUEST_WIFI_PS_CONFIG');
    expect(shim).toContain('WIFI_PS_ENABLED');
    expect(shim).toContain('WIFI_PS_DISABLED');
    // waits → block on the connected flag.
    expect(shim).toContain('__tc_wifi_wait_connected');
    expect(shim).toContain('__tc_wifi_wait_disconnected');
    // AP mode → net_mgmt AP_ENABLE/AP_DISABLE.
    expect(shim).toContain('__tc_wifi_ap_start');
    expect(shim).toContain('__tc_wifi_ap_stop');
    expect(shim).toContain('NET_REQUEST_WIFI_AP_ENABLE');
    expect(shim).toContain('NET_REQUEST_WIFI_AP_DISABLE');
  });
});

describe('wifi lowering — connection ops', () => {
  it('connect → blocking wrapper', () => {
    expect(lowerWifi({ operation: 'wifi.connect', ssid: '"net"', password: '"pw"', timeoutMs: 10000 } as any))
      .toEqual({ code: '__tc_wifi_connect("net", "pw", 10000);' });
  });
  it('connect_start → net_if_up + NET_REQUEST_WIFI_CONNECT kick', () => {
    expect(lowerWifi({ operation: 'wifi.connect_start', ssid: '"net"', password: '"pw"' } as any))
      .toEqual({ code: '__tc_wifi_connect_start("net", "pw");' });
  });
  it('disconnect → NET_REQUEST_WIFI_DISCONNECT', () => {
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
  it('set_power_save → NET_REQUEST_WIFI_PS_CONFIG', () => {
    // HAL modes "default" (on) / "none" (off); passed through verbatim.
    expect(lowerWifi({ operation: 'wifi.set_power_save', mode: '"default"' } as any))
      .toEqual({ code: '__tc_wifi_set_power_save("default");' });
    expect(lowerWifi({ operation: 'wifi.set_power_save', mode: '"none"' } as any))
      .toEqual({ code: '__tc_wifi_set_power_save("none");' });
  });
  it('on_event disconnect → assigns on_disconnect callback', () => {
    expect(lowerWifi({ operation: 'wifi.on_event', event: 'disconnect', handler: 'onLinkLost' } as any))
      .toEqual({ code: '__tc_wifi.on_disconnect = onLinkLost;' });
  });
  it('on_event connect → assigns on_connect callback', () => {
    expect(lowerWifi({ operation: 'wifi.on_event', event: 'connect', handler: 'onOnline' } as any))
      .toEqual({ code: '__tc_wifi.on_connect = onOnline;' });
  });
});

describe('wifi lowering — waits + AP mode', () => {
  it('wait_connected → blocks on the L4 flag with a timeout', () => {
    expect(lowerWifi({ operation: 'wifi.wait_connected', timeoutMs: 5000 } as any))
      .toEqual({ code: '__tc_wifi_wait_connected(5000);' });
    // Default timeout when none given.
    expect(lowerWifi({ operation: 'wifi.wait_connected' } as any))
      .toEqual({ code: '__tc_wifi_wait_connected(15000);' });
  });
  it('wait_disconnected → blocks until the L4 flag clears', () => {
    expect(lowerWifi({ operation: 'wifi.wait_disconnected' } as any))
      .toEqual({ code: '__tc_wifi_wait_disconnected();' });
  });
  it('ap_start → ap_enable with ssid/password/channel', () => {
    expect(lowerWifi({ operation: 'wifi.ap_start', ssid: '"hotspot"', password: '"pw"', channel: 6 } as any))
      .toEqual({ code: '__tc_wifi_ap_start("hotspot", "pw", 6);' });
    // No password → nullptr; no channel → 0 (shim treats as WIFI_CHANNEL_ANY).
    expect(lowerWifi({ operation: 'wifi.ap_start', ssid: '"open"' } as any))
      .toEqual({ code: '__tc_wifi_ap_start("open", nullptr, 0);' });
  });
  it('ap_stop → ap_disable', () => {
    expect(lowerWifi({ operation: 'wifi.ap_stop' } as any))
      .toEqual({ code: '__tc_wifi_ap_stop();' });
  });
});

describe('wifi lowering — out-of-scope ops return undefined', () => {
  // These are declared unsupported in the manifest (no Zephyr/driver hook); the
  // resolver must NOT lower them (the validator probes this). See the manifest's
  // per-op reasons. (ap_start/ap_stop/set_power_save/wait_* are now supported.)
  const unsupported = [
    'wifi.ap_client_count', 'wifi.ap_ip',
    'wifi.ap_set_channel', 'wifi.ap_set_hidden', 'wifi.ap_set_max_clients',
    'wifi.save_credentials', 'wifi.connect_saved', 'wifi.clear_credentials',
    'wifi.set_static_ip', 'wifi.set_auto_reconnect', 'wifi.set_tx_power',
  ];
  for (const op of unsupported) {
    it(`${op} → undefined`, () => {
      expect(lowerWifi({ operation: op } as any)).toBeUndefined();
    });
  }
});
