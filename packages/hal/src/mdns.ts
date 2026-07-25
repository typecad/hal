/**
 * MdnsClass — mDNS service discovery (ESP-IDF esp_mdns).
 *
 * Lowered to native mDNS HAL ops (mdns.*): ESP-IDF's esp_mdns component
 * advertises the device on the local network as `<hostname>.local` and
 * publishes services (e.g. `_http._tcp`) for discovery by Bonjour/Avahi.
 *
 * The semantic primitives (mdnsStart / mdnsAddService / ...) are resolved to
 * mdns.* HAL ops by the transpiler; this class is the ergonomic surface.
 *
 * Requires WiFi to be connected (mDNS rides on the station interface).
 */
export class MdnsClass {
  static readonly __instance_name = "MDNS";

  /** Initialize mDNS and set the host name (advertised as <name>.local). */
  start(hostname: string): boolean {
    mdnsStart(hostname);
    return true;
  }

  /** Set/override the host name after start(). */
  setHostname(name: string): void {
    mdnsSetHostname(name);
  }

  /** Publish a service instance. proto is "_tcp" or "_udp". */
  addService(instance: string, proto: string, port: number): void {
    mdnsAddService(instance, proto, port);
  }

  /** Advertise that the device is reachable (sends a probe/announce). */
  announce(): void {
    mdnsAnnounce();
  }

  /** Tear down the mDNS responder. */
  stop(): void {
    mdnsStop();
  }
}

export const MDNS = new MdnsClass();

// ── Semantic primitives (resolved to mdns.* HAL ops by the transpiler) ──
export function mdnsStart(hostname: string): void {}
export function mdnsSetHostname(name: string): void {}
export function mdnsAddService(instance: string, proto: string, port: number): void {}
export function mdnsAnnounce(): void {}
export function mdnsStop(): void {}
