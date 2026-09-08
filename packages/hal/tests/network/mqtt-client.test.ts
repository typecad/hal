// Hardware test for the @typecad/hal MQTT client.
//
// Connects to the local aedes broker (npm run test:mqtt / test:http — start-server
// runs an MQTT broker on 1883 + mqtts on 8883) and verifies the full pub/sub
// round-trip: connect → subscribe → publish → onMessage callback fires with the
// payload → connected → disconnect, over plain mqtt:// and mqtts:// (TLS).
//
// Run the broker in one terminal, then the test in another:
//   Terminal 1:  npm run test:mqtt --workspace @typecad/framework-zephyr
//   Terminal 2:  npm run test:hw:mqtt --workspace @typecad/framework-zephyr -- --port COM9
//
// The @typecad/hal/testing harness has no async/await. MQTT message delivery is
// asynchronous (the broker forwards the publish after the subscribe lands), so
// the onMessage callback records the payload into a global and the test busy-
// waits on it via Timing.delay, then asserts. Values are passed inline to
// .expect() via IIFEs (see http-client.test.ts) so the preprocessor hoists them
// as `: number` for the printf %g format check.
//
// Broker URIs must be full string literals — the HAL connect resolver expects a
// string literal (a template expression doesn't resolve).

// === EDIT THESE BEFORE FLASHING ===
const WIFI_SSID = "Skynet";
const WIFI_PASSWORD = "justin04";
// Your machine's LAN IP + the broker port (the one `npm run test:mqtt` reports).
// The broker URIs are inlined directly in the MQTT.connect() calls below (not as
// consts) because the transpiler drops a top-level const whose only reference is
// a HAL op call — inlining keeps the literal in the call site. Each must be a
// complete string literal.
//   plain:  "mqtt://192.168.2.184:1883"
//   TLS:    "mqtts://192.168.2.184:8883"
// ==================================

import { describe, done } from '@typecad/hal/testing';
import { WiFi, MQTT, Timing } from '@typecad/hal';

// CA certificate for the local mqtts:// broker (same CA as the HTTPS server —
// see certs/ca.crt (this directory)). Inlined as a single string literal so it
// lands at file scope (an imported const or multi-line concat lands in setup()-
// local scope where the test functions can't see it).
const CA_CERT_PEM = "-----BEGIN CERTIFICATE-----\nMIIDUzCCAjugAwIBAgIUfRQUm6IDRUUG1oRt6qNXmysZ6LgwDQYJKoZIhvcNAQEL\nBQAwMTEdMBsGA1UEAwwUVHlwZUNBRCBIVFRQIFRlc3QgQ0ExEDAOBgNVBAoMB1R5\ncGVDQUQwHhcNMjYwODAzMDYwNDIyWhcNMzYwNzMxMDYwNDIyWjAxMR0wGwYDVQQD\nDBRUeXBlQ0FEIEhUVFAgVGVzdCBDQTEQMA4GA1UECgwHVHlwZUNBRDCCASIwDQYJ\nKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMsrQFM93bvXAoUOUYYtNWwSssO02VZP\npMli0uHVxFBE0pqUa+uvDjw1RCKJ+PJL33svQLhtj+cXOriA2G30waknHpMPf1aM\najO4CIafX2FcWHvexQhCqfEcvCrFBxDAQNFdYsNMbI+AC/ovvTDaLdzcdpIcfoO5\nkE/Iu+k4ugcaqjnAPW0FME+mV2sp5/hez5LP/IYhpEuNvpvJZ8w3eZHPwxruLMNZ\nn8LmtVzg093yPLijjOvXPQi2O7P3xocUbU+w/5ON1NkXzqpVh+O7fHnkKiJp6ANu\nd5WDjoRNSJqCA467Ch9mDFeUNtureg7GzR1ILqchSdxX8eETm6Jh9dUCAwEAAaNj\nMGEwHwYDVR0RBBgwFoIUVHlwZUNBRCBIVFRQIFRlc3QgQ0EwDwYDVR0TAQH/BAUw\nAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFKWORpJuIVWrKQKrgm058sJN\nIQ+3MA0GCSqGSIb3DQEBCwUAA4IBAQCyfyasbiXOdmNCh2ybiLqpzDr6dbcZUSJS\nRaNZgYBctpeeWQHbNh/lObkzdhSr7sHNn1IgaWxSyxsOs8kBsAXRPluyy8oDxxMZ\neOH+XIa9fcm0fh+fkmlCHIJNzwFA0dcHv4lnrjohlVSfs3tC2TSlaWJLFef1oXIs\ngl1HLscOn9OrEtIHPKhiSJ1rgGJyoFoZGw7XO3AnoWlCKcg0W8HhmtKuqv5GKIEA\n0TsliYmsnjTj0449/Izyqlqa5GW9V2q4VJWZwMQ0vfnJMFSaRsJQqnw5WbkKmy5a\nov/Lt+pikXo1wnSW7+0ZPROtLry4SLOn+qTOkqQi8vpInTStM3ss\n-----END CERTIFICATE-----"

// Globals the onMessage callback writes and the assertions busy-wait on. The
// broker forwards a publish after the subscribe acks, so the test publishes then
// pumps Timing.delay until the callback flips received.
let received: number = 0;
let receivedPayload: string = "";

WiFi.connect(WIFI_SSID, WIFI_PASSWORD, 30000);

// The onMessage callback — the firmware transpiler lowers this to a C function
// whose name is passed to MQTT.onMessage. It sets the globals the test reads.
function onMessage(topic: string, payload: string): void {
  received = 1;
  receivedPayload = payload;
}

// ── Connect + connected ────────────────────────────────────────────

describe('MQTT client — connect')
  .it('connect() connects to the broker')
    .expect((() => { MQTT.connect("mqtt://192.168.2.184:1883", "typecad-hal test"); return 1; })()).toBe(1)
  .it('connected() is true after connect')
    .expect((() => { Timing.delay(2000); return MQTT.connected() ? 1 : 0; })()).toBe(1);

// ── Subscribe + publish + onMessage round-trip ─────────────────────
// Subscribe to a topic, register the callback, publish to it, then pump until
// the callback fires. This is the meaty test: it exercises the background poll
// thread, the event dispatch, and the user-callback handoff on real silicon.

describe('MQTT client — pub/sub round-trip')
  .it('subscribe + publish delivers to onMessage')
    .expect((() => {
      MQTT.onMessage(onMessage);
      MQTT.subscribe("test/topic");
      Timing.delay(1000);          // let the SUBACK land
      received = 0;
      MQTT.publish("test/topic", "hello-mqtt");
      // Pump until the broker forwards the publish back to us (async). Cap at ~8s.
      for (let i = 0; i < 80; i++) { Timing.delay(100); if (received) break; }
      return received;
    })()).toBe(1)
  .it('the received payload matches what was published')
    .expect((() => { return receivedPayload === "hello-mqtt" ? 1 : 0; })()).toBe(1);

// ── mqtts:// (TLS) pub/sub round-trip ──────────────────────────────

describe('MQTT client — mqtts (TLS) round-trip')
  .it('disconnect plain, reconnect over mqtts, round-trip a message')
    .expect((() => {
      MQTT.disconnect();
      Timing.delay(1000);
      MQTT.connect("mqtts://192.168.2.184:8883", "typecad-hal test-tls");
      Timing.delay(2000);
      if (!MQTT.connected()) return 0;
      MQTT.onMessage(onMessage);
      MQTT.subscribe("test/tls");
      Timing.delay(1000);
      received = 0;
      MQTT.publish("test/tls", "hello-mqtts");
      for (let i = 0; i < 80; i++) { Timing.delay(100); if (received) break; }
      return received;
    })()).toBe(1);

// ── Disconnect ─────────────────────────────────────────────────────

describe('MQTT client — disconnect')
  .it('disconnect() drops the connection')
    .expect((() => { MQTT.disconnect(); Timing.delay(1000); return MQTT.connected() ? 0 : 1; })()).toBe(1);

done();
