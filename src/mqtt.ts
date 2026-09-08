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
// ----------------------------------------------------------------------------

import { callback } from './callback.js';
import {
  mqttConnect, mqttOnMessage, mqttSubscribe, mqttPublish, mqttConnected, mqttDisconnect,
} from './emit.js';

export class Mqtt {
  private readonly _uri: string;
  private readonly _clientId: string;

  /** Construct the client for a broker ("mqtt://broker.local" or
   *  "mqtts://..." for TLS). */
  constructor(uri: string, opts: { clientId: string }) {
    this._uri = uri;
    this._clientId = opts.clientId;
  }

  /** Connect to the broker. Requires a network connection (WiFi) first.
   *  The Zephyr client completes the session in its poll thread — poll
   *  linked() afterwards. */
  connect(): void {
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
