// Hardware test for the @typecad/hal Mqtt class.
//
// Connects to the local aedes broker (npm run test:mqtt / test:http — start-server
// runs an MQTT broker on 1883 + mqtts on 8883, cert signed by certs/ca.crt) and
// verifies the full pub/sub round-trip: connect → subscribe → publish →
// onMessage callback fires with the payload → linked → disconnect, over plain
// mqtt://, mqtts:// without a CA (encrypted-but-unverified), and mqtts:// with
// caCert pinned (verified TLS — the analogue of Request's caCert).
//
// Run the broker in one terminal, then the test in another:
//   Terminal 1:  npm run test:mqtt
//   Terminal 2:  cd packages/hal/tests/network && npm exec -- typecad-hal test mqtt-client.test.ts
//
// The @typecad/hal/testing harness has no async/await. MQTT message delivery is
// asynchronous (the broker forwards the publish after the subscribe lands), so
// the onMessage callback records the payload into a global and the test busy-
// waits on it via Timing.delay, then asserts. Values are passed inline to
// .expect() via IIFEs (see http-client.test.ts) so the preprocessor hoists them
// as `: number` for the printf %g format check.
//
// The broker URI is a constructor literal (the construction-facts resolver
// expects a complete string literal), so the LAN IP is inlined below — edit the
// three URIs to your machine before flashing.

// === EDIT THESE BEFORE FLASHING ===
const WIFI_SSID = "Skynet";
const WIFI_PASSWORD = "justin04";
// Your machine's LAN IP + the broker ports (the ones `npm run test:mqtt`
// reports). Each URI below must stay a complete string literal.
//   plain:              "mqtt://192.168.2.184:1883"
//   TLS, no CA pinned:  "mqtts://192.168.2.184:8883"
//   TLS, CA pinned:     "mqtts://192.168.2.184:8883" (+ caCert: CA_CERT_PEM)
// ==================================

import { describe, done } from '@typecad/hal/testing';
import { WiFi, Mqtt, Time } from '@typecad/hal';

// CA certificate for the local mqtts:// broker (same CA as the HTTPS server —
// see certs/ca.crt (this directory); it signs the broker's 8883 cert). Inlined
// as a single string literal so it lands at file scope (an imported const or
// multi-line concat lands in setup()-local scope where the test functions
// can't see it).
const CA_CERT_PEM = "-----BEGIN CERTIFICATE-----\nMIIDUzCCAjugAwIBAgIUfRQUm6IDRUUG1oRt6qNXmysZ6LgwDQYJKoZIhvcNAQEL\nBQAwMTEdMBsGA1UEAwwUVHlwZUNBRCBIVFRQIFRlc3QgQ0ExEDAOBgNVBAoMB1R5\ncGVDQUQwHhcNMjYwODAzMDYwNDIyWhcNMzYwNzMxMDYwNDIyWjAxMR0wGwYDVQQD\nDBRUeXBlQ0FEIEhUVFAgVGVzdCBDQTEQMA4GA1UECgwHVHlwZUNBRDCCASIwDQYJ\nKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMsrQFM93bvXAoUOUYYtNWwSssO02VZP\npMli0uHVxFBE0pqUa+uvDjw1RCKJ+PJL33svQLhtj+cXOriA2G30waknHpMPf1aM\najO4CIafX2FcWHvexQhCqfEcvCrFBxDAQNFdYsNMbI+AC/ovvTDaLdzcdpIcfoO5\nkE/Iu+k4ugcaqjnAPW0FME+mV2sp5/hez5LP/IYhpEuNvpvJZ8w3eZHPwxruLMNZ\nn8LmtVzg093yPLijjOvXPQi2O7P3xocUbU+w/5ON1NkXzqpVh+O7fHnkKiJp6ANu\nd5WDjoRNSJqCA467Ch9mDFeUNtureg7GzR1ILqchSdxX8eETm6Jh9dUCAwEAAaNj\nMGEwHwYDVR0RBBgwFoIUVHlwZUNBRCBIVFRQIFRlc3QgQ0EwDwYDVR0TAQH/BAUw\nAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFKWORpJuIVWrKQKrgm058sJN\nIQ+3MA0GCSqGSIb3DQEBCwUAA4IBAQCyfyasbiXOdmNCh2ybiLqpzDr6dbcZUSJS\nRaNZgYBctpeeWQHbNh/lObkzdhSr7sHNn1IgaWxSyxsOs8kBsAXRPluyy8oDxxMZ\neOH+XIa9fcm0fh+fkmlCHIJNzwFA0dcHv4lnrjohlVSfs3tC2TSlaWJLFef1oXIs\ngl1HLscOn9OrEtIHPKhiSJ1rgGJyoFoZGw7XO3AnoWlCKcg0W8HhmtKuqv5GKIEA\n0TsliYmsnjTj0449/Izyqlqa5GW9V2q4VJWZwMQ0vfnJMFSaRsI+Qqnw5WbkKmy5\naov/Lt+pikXo1wnSW7+0ZPROtLry4SLOn+qTOkqQi8vpInTStM3ss\n-----END CERTIFICATE-----"

const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PASSWORD, timeoutMs: 30000 });
wifi.join();

// Globals the onMessage callback writes and the assertions busy-wait on. The
// broker forwards a publish after the subscribe acks, so the test publishes then
// pumps Timing.delay until the callback flips received.
let received: number = 0;
let receivedPayload: string = "";

// The onMessage callback — the firmware transpiler lowers this to a C function
// whose name is passed to Mqtt.onMessage. It sets the globals the test reads.
function onMessage(topic: string, payload: string): void {
  received = 1;
  receivedPayload = payload;
}

// The Mqtt verbs run directly on const instances (HAL instances are
// compile-time facts — no helper functions taking a Mqtt parameter). connect()
// runs at top level — never inside an expect IIFE — so the shim's error printks
// (DNS/handshake/CONNACK-timeout) can't race a protocol line. Retry connect()
// until the session is up — right after join() the resolver may not be
// provisioned yet (DNS EAI_FAIL on the first beat).

// ── Plain mqtt:// — connect + linked ───────────────────────────────

const mqtt = new Mqtt("mqtt://192.168.2.184:1883", { clientId: "typecad-hal test" });
for (let i = 0; i < 12; i = i + 1) {
  mqtt.connect();
  for (let j = 0; j < 8; j = j + 1) { Time.sleep(250); if (mqtt.linked()) break; }
  if (mqtt.linked()) break;
}

describe('Mqtt — connect')
  .it('connect() connects to the plain broker')
    .expect(mqtt.linked() ? 1 : 0).toBe(1);

// ── Subscribe + publish + onMessage round-trip ─────────────────────
// Subscribe to a topic, register the callback, publish to it, then pump until
// the callback fires. This is the meaty test: it exercises the background poll
// thread, the event dispatch, and the user-callback handoff on real silicon.

describe('Mqtt — pub/sub round-trip')
  .it('subscribe + publish delivers to onMessage')
    .expect((() => {
      mqtt.onMessage(onMessage);
      mqtt.subscribe("test/topic");
      Time.sleep(1000);          // let the SUBACK land
      received = 0;
      mqtt.publish("test/topic", "hello-mqtt");
      // Pump until the broker forwards the publish back to us (async). Cap at ~8s.
      for (let i = 0; i < 80; i++) { Time.sleep(100); if (received) break; }
      return received;
    })()).toBe(1)
  .it('the received payload matches what was published')
    .expect((() => { return receivedPayload === "hello-mqtt" ? 1 : 0; })()).toBe(1);

// ── mqtts:// without a CA — encrypted-but-unverified ───────────────
// The handshake completes (the session is encrypted) but the broker's identity
// is not verified: TLS_PEER_VERIFY_NONE, the strongest the no-caCert form can
// express.

describe('Mqtt — mqtts without a CA (encrypted-but-unverified)')
  .it('disconnect plain, reconnect over mqtts, round-trip a message')
    .expect((() => {
      mqtt.disconnect();
      Time.sleep(1000);
      const tls = new Mqtt("mqtts://192.168.2.184:8883", { clientId: "typecad-hal test-tls" });
      tls.connect();
      for (let j = 0; j < 20; j = j + 1) { Time.sleep(250); if (tls.linked()) break; }
      if (!tls.linked()) return 0;
      tls.onMessage(onMessage);
      tls.subscribe("test/tls");
      Time.sleep(1000);
      received = 0;
      tls.publish("test/tls", "hello-mqtts");
      for (let i = 0; i < 80; i++) { Time.sleep(100); if (received) break; }
      tls.disconnect();
      return received;
    })()).toBe(1);

// ── mqtts:// with caCert — verified TLS ────────────────────────────
// The pinned CA is DER-decoded at build time, registered as a CA_CERTIFICATE
// sec tag, and the handshake verifies the broker's chain
// (TLS_PEER_VERIFY_REQUIRED) — the MQTT analogue of the HTTPS caCert tests in
// http-client.test.ts. NOTE: on this Zephyr tree the pinned-CA handshake is
// subject to the same documented tf-psa-crypto symbol-matrix limitation as the
// HTTPS pinned tests (EPERM at connect) — the assert documents the target
// state; see the KNOWN LIMITATION note in framework-zephyr's kconfig block.

describe('Mqtt — mqtts with caCert (verified TLS)')
  .it('reconnect over mqtts with the CA pinned, round-trip a message')
    .expect((() => {
      Time.sleep(1000);
      const verified = new Mqtt("mqtts://192.168.2.184:8883", { clientId: "typecad-hal test-ca", caCert: CA_CERT_PEM });
      verified.connect();
      for (let j = 0; j < 20; j = j + 1) { Time.sleep(250); if (verified.linked()) break; }
      if (!verified.linked()) return 0;
      verified.onMessage(onMessage);
      verified.subscribe("test/tls-ca");
      Time.sleep(1000);
      received = 0;
      verified.publish("test/tls-ca", "hello-verified");
      for (let i = 0; i < 80; i++) { Time.sleep(100); if (received) break; }
      verified.disconnect();
      return received;
    })()).toBe(1);

// ── Disconnect ─────────────────────────────────────────────────────

describe('Mqtt — disconnect')
  .it('disconnect() drops the connection')
    .expect((() => { mqtt.disconnect(); Time.sleep(1000); return mqtt.linked() ? 0 : 1; })()).toBe(1);

done();
