// ---------------------------------------------------------------------------
// Mqtt — the thin pub/sub client
//
// The broker URI and client id are CONSTRUCTION facts; the verbs map onto
// the Zephyr MQTT client (mqtt_connect / mqtt_publish / mqtt_subscribe,
// with a poll thread feeding mqtt_input/mqtt_live):
//
//   connect()     → establish the broker session (poll linked() after —
//                   the Zephyr client connects in its poll thread)
//   onMessage(cb) → handler for every received PUBLISH on a subscribed
//                   topic — receives (topic, payload)
//   subscribe(t)  → subscribe to a topic filter ("sensors/#")
//   publish(t, s) → publish a message
//   linked()      → the broker session is up
//   disconnect()  → disconnect and free the client
//
// mqtts:// TLS policy is a construction fact like Request's: caCert (PEM)
// pins the broker's CA for verified TLS; without it the session is
// encrypted-but-unverified.
// ----------------------------------------------------------------------------

import { callback } from './callback.js';
import {
  mqttConnect, mqttSetCaCert, mqttOnMessage, mqttSubscribe, mqttPublish, mqttConnected, mqttDisconnect,
} from './emit.js';

/** Mqtt construction facts beyond the broker URI. */
export interface MqttOpts {
  /** Client id the broker sees (required). */
  clientId: string;
  /** PEM of a trusted CA — enables verified TLS for mqtts:// brokers. */
  caCert?: string;
}

/**
 * An MQTT pub/sub client: `const m = new Mqtt('mqtt://broker.local', {
 * clientId: 'dev1' }); m.onMessage((topic, payload) => ...); m.connect();`.
 * connect() starts the session — poll linked() until it reports up.
 * subscribe() adds a topic filter, publish() sends a message. For TLS
 * brokers use `mqtts://` and pin the broker's CA with `opts.caCert`.
 */
export class Mqtt {
  private readonly _uri: string;
  private readonly _clientId: string;
  private readonly _caCert: string;

  /** Construct the client for a broker ("mqtt://broker.local" or
   *  "mqtts://..." for TLS — pin its CA with opts.caCert for verified
   *  TLS). */
  constructor(uri: string, opts: MqttOpts) {
    this._uri = uri;
    this._clientId = opts.clientId;
    this._caCert = opts.caCert ?? '';
  }

  /** Connect to the broker. Requires a network connection first (e.g.
   *  `WiFi.join()`). The session completes in the background — poll
   *  linked() until it reports true. */
  connect(): void {
    mqttSetCaCert(this._caCert);
    mqttConnect(this._uri, this._clientId);
  }

  /** Handler invoked for every received PUBLISH on a subscribed topic. */
  onMessage(handler: (topic: string, payload: string) => void): void {
    mqttOnMessage(callback(handler));
  }

  /** Subscribe to a topic filter (e.g. "sensors/#"). */
  subscribe(topic: string): void {
    mqttSubscribe(topic);
  }

  /** Publish a message to a topic. */
  publish(topic: string, data: string): void {
    mqttPublish(topic, data);
  }

  /** True while the broker session is up. */
  linked(): boolean {
    return mqttConnected();
  }

  /** Disconnect from the broker and free the client. */
  disconnect(): void {
    mqttDisconnect();
  }
}
