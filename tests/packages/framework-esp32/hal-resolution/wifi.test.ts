import { describe, it, expect } from 'vitest';
import { lowerWifi, wifiInitLines } from '../../../../packages/framework-esp32/src/lowering/wifi';

describe('wifi init block', () => {
  it('emits CUTTLEFISH_WIFI markers', () => {
    const lines = wifiInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_WIFI_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_WIFI_END');
  });

  it('registers the IDF event handler', () => {
    expect(wifiInitLines().join('\n')).toMatch(/__tc_wifi_event_handler/);
  });

  it('uses the deferred tx-power apply helper (brownout-fix regression guard)', () => {
    // __tc_wifi_apply_tx_power + tx_power_qdbm stash exists because
    // esp_wifi_set_max_tx_power is a no-op before the radio starts. The
    // previous direct-call shape caused TX-power settings to silently drop
    // and, in some sequences, contributed to early-boot reboots.
    const lines = wifiInitLines().join('\n');
    expect(lines).toContain('__tc_wifi_apply_tx_power');
    expect(lines).toContain('tx_power_qdbm');
  });

  it('pauses the Task WDT around the blocking wait loops (WDT-starvation fix)', () => {
    // main_task (which runs setup/loop) is not on the WDT subscription list
    // (only the per-core IDLE tasks are), so esp_task_wdt_reset() is a no-op
    // here and we must stop the timer itself during the multi-second blocking
    // waits. Without this, CPU0's IDLE task can be starved by the prio-23
    // WiFi task during radio bring-up and the chip reboots with TG1WDT_SYS_RST.
    // The pause/resume must be balanced on every exit path of every wait site.
    const lines = wifiInitLines().join('\n');
    expect(lines).toContain('__tc_wifi_pause_wdt');
    expect(lines).toContain('__tc_wifi_resume_wdt');
    // esp_task_wdt_stop/restart live in esp_private/esp_task_wdt.h, which
    // only declares them when CONFIG_ESP_TASK_WDT_EN — so the calls must be
    // compile-time gated to keep builds with the WDT disabled working.
    expect(lines).toContain('#if CONFIG_ESP_TASK_WDT_EN');
    expect(lines).toMatch(/esp_task_wdt_stop\(\)/);
    expect(lines).toMatch(/esp_task_wdt_restart\(\)/);
    expect(lines).toMatch(/#else\s*\nstatic inline void __tc_wifi_pause_wdt/);
    // All three blocking wait sites must be wrapped. Match each function by
    // its exact signature boundary so __tc_wifi_scan doesn't match
    // __tc_wifi_scan_start/_done/_count/etc.
    const waitConnected = lines.match(/__tc_wifi_wait_connected\(uint32_t[^)]*\)[\s\S]*?^}/m)?.[0] ?? '';
    const waitDisconnected = lines.match(/__tc_wifi_wait_disconnected\(void\)[\s\S]*?^}/m)?.[0] ?? '';
    const scan = lines.match(/__tc_wifi_scan\(void\)[\s\S]*?^}/m)?.[0] ?? '';
    expect(waitConnected).toContain('__tc_wifi_pause_wdt()');
    expect(waitConnected).toContain('__tc_wifi_resume_wdt()');
    expect(waitDisconnected).toContain('__tc_wifi_pause_wdt()');
    expect(waitDisconnected).toContain('__tc_wifi_resume_wdt()');
    expect(scan).toContain('__tc_wifi_pause_wdt()');
    expect(scan).toContain('__tc_wifi_resume_wdt()');
  });
});

describe('wifi lowering — connect / lifecycle', () => {
  it('connect (blocking) → __tc_wifi_connect(...) expression', () => {
    expect(lowerWifi({ operation: 'wifi.connect', ssid: '"HomeNet"', password: '"hunter22"', timeoutMs: 15000 }))
      .toEqual({ expression: '__tc_wifi_connect("HomeNet", "hunter22", 15000)' });
  });

  it('connect_start (cooperative await half) → __tc_wifi_connect_start(...); statement', () => {
    expect(lowerWifi({ operation: 'wifi.connect_start', ssid: '"HomeNet"', password: '"hunter22"' }))
      .toEqual({ code: '__tc_wifi_connect_start("HomeNet", "hunter22");' });
  });

  it('connect_start with omitted password emits empty-string literal', () => {
    expect(lowerWifi({ operation: 'wifi.connect_start', ssid: '"Open"' }))
      .toEqual({ code: '__tc_wifi_connect_start("Open", "");' });
  });

  it('wait_connected → __tc_wifi_wait_connected(...) expression', () => {
    expect(lowerWifi({ operation: 'wifi.wait_connected', timeoutMs: 10000 }))
      .toEqual({ expression: '__tc_wifi_wait_connected(10000)' });
  });

  it('wait_connected defaults timeout to 0 (wait forever)', () => {
    expect(lowerWifi({ operation: 'wifi.wait_connected' } as any))
      .toEqual({ expression: '__tc_wifi_wait_connected(0)' });
  });

  it('wait_disconnected → __tc_wifi_wait_disconnected(); statement', () => {
    expect(lowerWifi({ operation: 'wifi.wait_disconnected' }))
      .toEqual({ code: '__tc_wifi_wait_disconnected();' });
  });

  it('disconnect → __tc_wifi_disconnect();', () => {
    expect(lowerWifi({ operation: 'wifi.disconnect' }))
      .toEqual({ code: '__tc_wifi_disconnect();' });
  });

  it('connect_saved → __tc_wifi_connect_saved(timeout) expression', () => {
    expect(lowerWifi({ operation: 'wifi.connect_saved', timeoutMs: 5000 }))
      .toEqual({ expression: '__tc_wifi_connect_saved(5000)' });
  });
});

describe('wifi lowering — status queries (all expressions)', () => {
  it('status → __tc_wifi.status', () => {
    expect(lowerWifi({ operation: 'wifi.status' })).toEqual({ expression: '__tc_wifi.status' });
  });
  it('is_connected → __tc_wifi_is_connected()', () => {
    // Poll predicate paired with wifi.connect_start in the async state machine.
    expect(lowerWifi({ operation: 'wifi.is_connected' })).toEqual({ expression: '__tc_wifi_is_connected()' });
  });
  it('local_ip → __tc_wifi_local_ip()', () => {
    expect(lowerWifi({ operation: 'wifi.local_ip' })).toEqual({ expression: '__tc_wifi_local_ip()' });
  });
  it('rssi → __tc_wifi_rssi()', () => {
    expect(lowerWifi({ operation: 'wifi.rssi' })).toEqual({ expression: '__tc_wifi_rssi()' });
  });
  it('mac → __tc_wifi_mac()', () => {
    expect(lowerWifi({ operation: 'wifi.mac' })).toEqual({ expression: '__tc_wifi_mac()' });
  });
});

describe('wifi lowering — configuration setters', () => {
  it('set_hostname → __tc_wifi_set_hostname(name);', () => {
    expect(lowerWifi({ operation: 'wifi.set_hostname', name: '"sensor-1"' }))
      .toEqual({ code: '__tc_wifi_set_hostname("sensor-1");' });
  });

  it('set_static_ip → __tc_wifi_static_ip(ip, gw, subnet, dns);', () => {
    expect(lowerWifi({
      operation: 'wifi.set_static_ip',
      ip: '"10.0.0.5"', gateway: '"10.0.0.1"', subnet: '"255.255.255.0"', dns: '"8.8.8.8"',
    }))
      .toEqual({ code: '__tc_wifi_static_ip("10.0.0.5", "10.0.0.1", "255.255.255.0", "8.8.8.8");' });
  });

  it('set_static_ip with omitted dns emits empty string', () => {
    expect(lowerWifi({
      operation: 'wifi.set_static_ip',
      ip: '"10.0.0.5"', gateway: '"10.0.0.1"', subnet: '"255.255.255.0"',
    }))
      .toEqual({ code: '__tc_wifi_static_ip("10.0.0.5", "10.0.0.1", "255.255.255.0", "");' });
  });

  it('set_auto_reconnect(true) → struct field assignment true', () => {
    expect(lowerWifi({ operation: 'wifi.set_auto_reconnect', enabled: true }))
      .toEqual({ code: '__tc_wifi.auto_reconnect = true;' });
  });

  it('set_auto_reconnect(false) → struct field assignment false', () => {
    expect(lowerWifi({ operation: 'wifi.set_auto_reconnect', enabled: false }))
      .toEqual({ code: '__tc_wifi.auto_reconnect = false;' });
  });

  it('set_power_save("none") → JSON-stringified bare mode', () => {
    // The lowering strips surrounding quotes and JSON-stringifies, so the
    // emitted arg is "none" (a C string literal).
    expect(lowerWifi({ operation: 'wifi.set_power_save', mode: '"none"' }))
      .toEqual({ code: '__tc_wifi_set_power_save("none");' });
  });

  it('set_tx_power → __tc_wifi_set_tx_power(dbm); (defers actual apply)', () => {
    expect(lowerWifi({ operation: 'wifi.set_tx_power', dbm: 10 }))
      .toEqual({ code: '__tc_wifi_set_tx_power(10);' });
  });
});

describe('wifi lowering — event callbacks', () => {
  it('on_event connect → on_connect field', () => {
    expect(lowerWifi({ operation: 'wifi.on_event', event: 'connect', handler: '"myHandler"' }))
      .toEqual({ code: '__tc_wifi.on_connect = &"myHandler";' });
  });
  it('on_event disconnect → on_disconnect field', () => {
    expect(lowerWifi({ operation: 'wifi.on_event', event: 'disconnect', handler: '"myHandler"' }))
      .toEqual({ code: '__tc_wifi.on_disconnect = &"myHandler";' });
  });
  it('on_event got_ip → on_got_ip field', () => {
    expect(lowerWifi({ operation: 'wifi.on_event', event: 'got_ip', handler: '"myHandler"' }))
      .toEqual({ code: '__tc_wifi.on_got_ip = &"myHandler";' });
  });
});

describe('wifi lowering — SoftAP', () => {
  it('ap_start → __tc_wifi_ap_start(ssid, pass) expression', () => {
    expect(lowerWifi({ operation: 'wifi.ap_start', ssid: '"setup"', password: '"config123"' }))
      .toEqual({ expression: '__tc_wifi_ap_start("setup", "config123")' });
  });
  it('ap_start open (no password)', () => {
    expect(lowerWifi({ operation: 'wifi.ap_start', ssid: '"setup"' }))
      .toEqual({ expression: '__tc_wifi_ap_start("setup", "")' });
  });
  it('ap_stop → __tc_wifi_ap_stop();', () => {
    expect(lowerWifi({ operation: 'wifi.ap_stop' })).toEqual({ code: '__tc_wifi_ap_stop();' });
  });
  it('ap_client_count → __tc_wifi_ap_client_count()', () => {
    expect(lowerWifi({ operation: 'wifi.ap_client_count' })).toEqual({ expression: '__tc_wifi_ap_client_count()' });
  });
  it('ap_ip → __tc_wifi_ap_ip()', () => {
    expect(lowerWifi({ operation: 'wifi.ap_ip' })).toEqual({ expression: '__tc_wifi_ap_ip()' });
  });
  it('ap_set_channel → struct field assignment', () => {
    expect(lowerWifi({ operation: 'wifi.ap_set_channel', channel: 6 }))
      .toEqual({ code: '__tc_wifi.ap_channel = 6;' });
  });
  it('ap_set_hidden(true) → struct field', () => {
    expect(lowerWifi({ operation: 'wifi.ap_set_hidden', hidden: true }))
      .toEqual({ code: '__tc_wifi.ap_hidden = true;' });
  });
  it('ap_set_max_clients → struct field', () => {
    expect(lowerWifi({ operation: 'wifi.ap_set_max_clients', maxClients: 4 }))
      .toEqual({ code: '__tc_wifi.ap_max_clients = 4;' });
  });
});

describe('wifi lowering — scan', () => {
  it('scan (blocking) → __tc_wifi_scan() expression', () => {
    expect(lowerWifi({ operation: 'wifi.scan' })).toEqual({ expression: '__tc_wifi_scan()' });
  });
  it('scan_start (cooperative await half) → __tc_wifi_scan_start();', () => {
    expect(lowerWifi({ operation: 'wifi.scan_start' })).toEqual({ code: '__tc_wifi_scan_start();' });
  });
  it('scan_done (poll predicate) → __tc_wifi_scan_done()', () => {
    expect(lowerWifi({ operation: 'wifi.scan_done' })).toEqual({ expression: '__tc_wifi_scan_done()' });
  });
  it('scan_count → __tc_wifi_scan_count()', () => {
    expect(lowerWifi({ operation: 'wifi.scan_count' })).toEqual({ expression: '__tc_wifi_scan_count()' });
  });
  it('scan_ssid(i) → __tc_wifi_scan_ssid(i)', () => {
    expect(lowerWifi({ operation: 'wifi.scan_ssid', index: 2 }))
      .toEqual({ expression: '__tc_wifi_scan_ssid(2)' });
  });
  it('scan_rssi(i) → __tc_wifi_scan_rssi(i)', () => {
    expect(lowerWifi({ operation: 'wifi.scan_rssi', index: 2 }))
      .toEqual({ expression: '__tc_wifi_scan_rssi(2)' });
  });
  it('scan_encryption(i) → __tc_wifi_scan_encryption(i)', () => {
    expect(lowerWifi({ operation: 'wifi.scan_encryption', index: 2 }))
      .toEqual({ expression: '__tc_wifi_scan_encryption(2)' });
  });
  it('scan_channel(i) → __tc_wifi_scan_channel(i)', () => {
    expect(lowerWifi({ operation: 'wifi.scan_channel', index: 2 }))
      .toEqual({ expression: '__tc_wifi_scan_channel(2)' });
  });
});

describe('wifi lowering — NVS credentials', () => {
  it('save_credentials → __tc_wifi_save_credentials(ssid, pass);', () => {
    expect(lowerWifi({ operation: 'wifi.save_credentials', ssid: '"HomeNet"', password: '"hunter22"' }))
      .toEqual({ code: '__tc_wifi_save_credentials("HomeNet", "hunter22");' });
  });
  it('clear_credentials → __tc_wifi_clear_credentials();', () => {
    expect(lowerWifi({ operation: 'wifi.clear_credentials' }))
      .toEqual({ code: '__tc_wifi_clear_credentials();' });
  });
});

describe('wifi lowering — error handling', () => {
  it('unknown wifi.* op throws', () => {
    expect(() => lowerWifi({ operation: 'wifi.unknown' } as any)).toThrow(/does not yet support/);
  });
});
