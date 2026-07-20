// ---------------------------------------------------------------------------
// HAL WiFi Tests — ESP32 transpilation
//
// End-to-end coverage of the WiFi HAL through the ESP32 strategy: header
// gating, shim emission, and (the only place in the repo that covers it)
// the cooperative await → start + poll lowering for wifi.connect.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  expectCppContains,
  expectCppNotContains,
  hasInclude,
  transpileEsp32Strategy,
  findDiagnostics,
} from '../../setup';

describe('WiFi HAL — ESP32 transpilation', () => {
  describe('basic STA connect', () => {
    const snippet = `
      import { WiFi } from '@typecad/hal';
      WiFi.connect("HomeNet", "hunter22");
      console.log(WiFi.localIP());
    `;

    it('lowers WiFi.connect to the blocking __tc_wifi_connect shim', () => {
      const result = transpileEsp32Strategy(snippet);
      expectCppContains(result, ['__tc_wifi_connect("HomeNet", "hunter22",']);
    });

    it('lowers WiFi.localIP() to __tc_wifi_local_ip()', () => {
      const result = transpileEsp32Strategy(snippet);
      expectCppContains(result, ['__tc_wifi_local_ip()']);
    });

    it('forces esp_wifi.h include only when WiFi is used (gated by usesWifi)', () => {
      const result = transpileEsp32Strategy(snippet);
      expect(hasInclude(result.cpp, '"esp_wifi.h"')).toBe(true);
    });

    it('emits the CUTTLEFISH_WIFI shim block', () => {
      const result = transpileEsp32Strategy(snippet);
      expect(result.cpp).toContain('// CUTTLEFISH_WIFI_BEGIN');
      expect(result.cpp).toContain('// CUTTLEFISH_WIFI_END');
    });

    it('compiles cleanly (no error diagnostics)', () => {
      const result = transpileEsp32Strategy(snippet);
      expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    });
  });

  describe('cooperative await path', () => {
    // The awaited form must lower to wifi.connect_start (statement) + a poll
    // on wifi.is_connected (expression), NOT a blocking wifi.connect call.
    // This is the contract the async state machine depends on.
    const asyncSnippet = `
      import { WiFi } from '@typecad/hal';
      async function connect() {
        await WiFi.connect("HomeNet", "hunter22", 5000);
        console.log(WiFi.localIP());
      }
    `;

    it('emits the start op (__tc_wifi_connect_start)', () => {
      const result = transpileEsp32Strategy(asyncSnippet);
      expect(result.cpp).toContain('__tc_wifi_connect_start("HomeNet", "hunter22");');
    });

    it('emits the poll predicate (__tc_wifi_is_connected)', () => {
      const result = transpileEsp32Strategy(asyncSnippet);
      expect(result.cpp).toMatch(/__tc_wifi_is_connected\(\)/);
    });

    it('does NOT emit a blocking __tc_wifi_connect( call inside the async task', () => {
      const result = transpileEsp32Strategy(asyncSnippet);
      // The shim source defines __tc_wifi_connect (and __tc_wifi_connect_start)
      // as helpers — those definitions are fine. What we want to rule out is
      // the await lowering to the *blocking* call. Strip the CUTTLEFISH_WIFI
      // shim block before checking so helper definitions don't false-positive.
      const withoutShim = result.cpp.replace(
        /\/\/ CUTTLEFISH_WIFI_BEGIN[\s\S]*?\/\/ CUTTLEFISH_WIFI_END/g,
        '',
      );
      expect(withoutShim).not.toMatch(/__tc_wifi_connect\(/);
    });
  });

  describe('softAP transpiles', () => {
    it('startAP → __tc_wifi_ap_start(ssid, pass)', () => {
      const result = transpileEsp32Strategy(`
        import { WiFi } from '@typecad/hal';
        WiFi.startAP("setup", "config123");
      `);
      expectCppContains(result, ['__tc_wifi_ap_start("setup", "config123")']);
    });
  });

  describe('scan transpiles', () => {
    it('WiFi.scan() → blocking __tc_wifi_scan()', () => {
      const result = transpileEsp32Strategy(`
        import { WiFi } from '@typecad/hal';
        const n = WiFi.scan();
      `);
      expect(result.cpp).toMatch(/__tc_wifi_scan\(\)/);
    });
  });

  describe('diagnostic surface — wifi-no-radio (negative case)', () => {
    // The positive case (wifi-no-radio fires on AVR) requires the AVR board
    // `architecture` constant, which the test harness does not populate for
    // transpileAVR() — and the validator's "no fallbacks" rule means absent
    // board data emits nothing. The positive case is therefore covered at
    // the unit level in tests/packages/cuttlefish/network-validation.test.ts
    // by calling validateNetworkUsage() with a fake boardConstants Map.
    it('does NOT fire wifi-no-radio on a WiFi-capable target (ESP32)', () => {
      const result = transpileEsp32Strategy(`
        import { WiFi } from '@typecad/hal';
        WiFi.connect("S", "P");
      `);
      expect(findDiagnostics(result, 'wifi-no-radio')).toEqual([]);
    });
  });
});
