// ---------------------------------------------------------------------------
// HAL MQTT Tests — Zephyr transpilation
//
// End-to-end coverage of the thin Mqtt class through the ZephyrStrategy:
// construction facts (broker URI, clientId, and the caCert CA-pinning fact —
// the analogue of Request's caCert), the connect() setter ordering (the CA
// must land in the shim before __tc_mqtt_connect runs), and the pub/sub
// verbs. Uses transpileZephyrStrategy() because the mqtt.* ops lower via
// ZephyrStrategy.resolveHALOperation.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { expectCppContains, expectCppNotContains, hasInclude, transpileZephyrStrategy } from '../../setup';

describe('MQTT HAL — Zephyr transpilation', () => {
  describe('connect smoke', () => {
    const snippet = `
      import { Mqtt } from '@typecad/hal';
      const mqtt = new Mqtt("mqtt://broker.local:1883", { clientId: "sensor-01" });
      mqtt.connect();
    `;

    it('lowers connect to __tc_mqtt_connect(uri, clientId)', () => {
      const result = transpileZephyrStrategy(snippet);
      expectCppContains(result, ['__tc_mqtt_connect("mqtt://broker.local:1883", "sensor-01");']);
    });

    it('elides the no-CA sentinel (plain mqtt:// carries no DER array)', () => {
      const result = transpileZephyrStrategy(snippet);
      // The shim helper itself always ships; only the pinned-CA emission
      // (the static DER array + its staging call) must be absent.
      expectCppNotContains(result, ['static const uint8_t __tc_mqtt_ca_der[]']);
    });

    it('forces the Zephyr mqtt + tls headers only when Mqtt is used', () => {
      const result = transpileZephyrStrategy(snippet);
      expect(hasInclude(result.cpp, '<zephyr/net/mqtt.h>')).toBe(true);
      expect(hasInclude(result.cpp, '<zephyr/net/tls_credentials.h>')).toBe(true);
    });
  });

  describe('mqtts with caCert (verified TLS)', () => {
    // A real (if toy) self-signed CA cert PEM — enough base64 to pass the
    // decoder's sanity floor, same one the lowering unit test uses.
    const pem = '-----BEGIN CERTIFICATE-----\nMIIDUzCCAjugAwIBAgIUfRQUm6IDRUUG1oRt6qNXmysZ6gwDQYJKoZIhvcNAQEL\nBQAwMTEdMBsGA1UEAwwUVHlwZUNBRCBIVFRQIFRlc3QgQ0ExEDAOBgNVBAoMB1R5\ncGVDQUQwHhcNMjYwODAzMDYwNDIyWhcNMzYwNzMxMDYwNDIyWjAxMR0wGwYDVQQD\n-----END CERTIFICATE-----\n';

    it('decodes the PEM to a DER byte array before connect', () => {
      const result = transpileZephyrStrategy(`
        import { Mqtt } from '@typecad/hal';
        const PEM = "${pem.replace(/\n/g, '\\n')}";
        const mqtt = new Mqtt("mqtts://broker.local", { clientId: "sensor-01", caCert: PEM });
        mqtt.connect();
      `);
      expect(result.cpp).toContain('static const uint8_t __tc_mqtt_ca_der[] = { 0x30, 0x82');
      expect(result.cpp).toContain('__tc_mqtt_set_ca_cert_der(__tc_mqtt_ca_der, sizeof(__tc_mqtt_ca_der));');
      // The CA must be staged before the session starts.
      expect(result.cpp.indexOf('__tc_mqtt_set_ca_cert_der')).toBeLessThan(result.cpp.indexOf('__tc_mqtt_connect("mqtts://broker.local"'));
    });

    it('accepts an inline PEM literal too', () => {
      const result = transpileZephyrStrategy(`
        import { Mqtt } from '@typecad/hal';
        const mqtt = new Mqtt("mqtts://broker.local", { clientId: "sensor-01", caCert: "${pem.replace(/\n/g, '\\n')}" });
        mqtt.connect();
      `);
      expect(result.cpp).toContain('__tc_mqtt_set_ca_cert_der');
    });
  });

  describe('pub/sub verbs', () => {
    it('subscribe/publish/linked/dispatch lower onto the shim', () => {
      const result = transpileZephyrStrategy(`
        import { Mqtt } from '@typecad/hal';
        const mqtt = new Mqtt("mqtt://broker.local", { clientId: "sensor-01" });
        mqtt.onMessage((topic: string, payload: string): void => {});
        mqtt.subscribe("sensors/#");
        mqtt.publish("sensors/room/temp", "21.5");
        const up = mqtt.linked();
        mqtt.disconnect();
      `);
      expectCppContains(result, [
        '__tc_mqtt_subscribe("sensors/#");',
        '__tc_mqtt_publish("sensors/room/temp", "21.5");',
        '(__tc_mqtt.connected)',
        '__tc_mqtt_disconnect();',
      ]);
    });
  });

  describe('inline construction (bare receiver)', () => {
    it('connect() on a bare new Mqtt(...) still carries the facts', () => {
      const result = transpileZephyrStrategy(`
        import { Mqtt } from '@typecad/hal';
        new Mqtt("mqtt://broker.local", { clientId: "inline-01" }).connect();
      `);
      expectCppContains(result, ['__tc_mqtt_connect("mqtt://broker.local", "inline-01");']);
    });
  });

  describe('construction inside a function scope (hardware-test IIFE shape)', () => {
    it('captures the caCert const + facts and stages the CA before connect', () => {
      const pem = '-----BEGIN CERTIFICATE-----\nMIIDUzCCAjugAwIBAgIUfRQUm6IDRUUG1oRt6qNXmysZ6gwDQYJKoZIhvcNAQEL\nBQAwMTEdMBsGA1UEAwwUVHlwZUNBRCBIVFRQIFRlc3QgQ0ExEDAOBgNVBAoMB1R5\ncGVDQUQwHhcNMjYwODAzMDYwNDIyWhcNMzYwNzMxMDYwNDIyWjAxMR0wGwYDVQQD\n-----END CERTIFICATE-----\n';
      const result = transpileZephyrStrategy(`
        import { Mqtt } from '@typecad/hal';
        const CA_CERT_PEM = "${pem.replace(/\n/g, '\\n')}";
        let received = 0;
        function probe(): number {
          const verified = new Mqtt("mqtts://broker.local", { clientId: "probe", caCert: CA_CERT_PEM });
          verified.connect();
          if (!verified.linked()) return 0;
          verified.publish("test/tls", "hello");
          return received;
        }
        probe();
      `);
      expect(result.cpp).toContain('static const uint8_t __tc_mqtt_ca_der[] = { 0x30, 0x82');
      expect(result.cpp).toContain('__tc_mqtt_connect("mqtts://broker.local", "probe");');
      expect(result.cpp.indexOf('__tc_mqtt_set_ca_cert_der')).toBeLessThan(result.cpp.indexOf('__tc_mqtt_connect("mqtts://broker.local"'));
    });
  });
});
