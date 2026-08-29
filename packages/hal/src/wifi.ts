// ---------------------------------------------------------------------------
// WiFi — the thin Zephyr-shaped station/AP wrappers
//
// The link policy is CONSTRUCTION facts: credentials, security, band/channel,
// join timeout, power-save, and (optionally) static IPv4 all ride the join op
// (the sensor discipline — every op carries its construction facts). Methods
// lower 1:1 onto Zephyr's net_mgmt/wifi_mgmt surface:
//
//   join()    → wifi_connect_req_params from the facts + a bounded wait on
//               the L4 connected flag (conn_mgr monitor raises it post-DHCP,
//               or immediately when static IPv4 facts are configured).
//               Returns boolean — no exceptions. Awaitable in async contexts
//               (start + poll split, like Time.sleep).
//   leave()   → NET_REQUEST_WIFI_DISCONNECT
//   linked() / rssi() / ip() / mac() → iface-status + net_if queries
//   onUp() / onDrop() → the L4 / IPv4-addr net_mgmt event callbacks
//   scan()    → one blocking scan, results read through the Scan handle
//               (fixed pool, no heap)
//
// WiFiAP carries the SoftAP facts (ssid/psk/channel) the same way:
// start()/stop() map to NET_REQUEST_WIFI_AP_ENABLE/DISABLE.
// ----------------------------------------------------------------------------

import {
  wifiJoin, wifiConnectStart, wifiDisconnect, wifiIsConnected, wifiLocalIp,
  wifiRssi, wifiMac, wifiOnEvent, wifiScan, wifiScanCount, wifiScanSsid,
  wifiScanRssi, wifiScanEncryption, wifiScanChannel, wifiApStart, wifiApStop,
} from './emit.js';
import { callback } from './callback.js';

export class WiFi {
  /** Security tokens — lowered to Zephyr's wifi_security_type enum. */
  static readonly OPEN = 0;
  static readonly WPA2 = 1;
  static readonly WPA3 = 2;
  static readonly WPA2_WPA3 = 3;

  /** Band tokens. */
  static readonly BAND_2_4 = 0;
  static readonly BAND_5 = 1;

  /** Power-save token — pass PS_OFF to disable the radio's modem sleep. */
  static readonly PS_OFF = 0;

  private readonly _ssid: string;
  private readonly _psk: string | undefined;
  private readonly _security: number;
  private readonly _channel: number;
  private readonly _band: number;
  private readonly _timeoutMs: number;
  private readonly _ps: number;
  private readonly _ipAddr: string | undefined;
  private readonly _gateway: string | undefined;
  private readonly _netmask: string | undefined;

  /** Construct a station link policy. `psk` omitted → open network;
   *  `security` defaults WPA2 when a psk is present, OPEN otherwise;
   *  `channel` 0/omitted = any. `ipv4` opts out of DHCP with static facts. */
  constructor(ssid: string, opts: {
    psk?: string;
    security?: number;
    channel?: number;
    band?: number;
    timeoutMs?: number;
    powerSave?: number;
    ipv4?: { addr: string; gateway: string; netmask: string };
  } = {}) {
    this._ssid = ssid;
    this._psk = opts.psk;
    this._security = opts.security ?? (opts.psk !== undefined ? WiFi.WPA2 : WiFi.OPEN);
    this._channel = opts.channel ?? 0;
    this._band = opts.band ?? WiFi.BAND_2_4;
    this._timeoutMs = opts.timeoutMs ?? 15000;
    this._ps = opts.powerSave ?? 0;
    this._ipAddr = opts.ipv4?.addr;
    this._gateway = opts.ipv4?.gateway;
    this._netmask = opts.ipv4?.netmask;
  }

  /** Join the network. Blocks (bounded by timeoutMs, pumping a mounted UI's
   *  tick between polls); returns true once IP connectivity is up, false on
   *  timeout or missing radio. Idempotent-ish: re-joining re-associates. */
  join(): boolean {
    return wifiJoin(this._ssid, this._psk, this._security, this._channel,
      this._band, this._timeoutMs, this._ps, this._ipAddr, this._gateway,
      this._netmask);
  }

  /** Fire-and-forget join — poll linked() or await in an async function. */
  joinStart(): void {
    wifiConnectStart(this._ssid, this._psk);
  }

  /** Leave the network (NET_REQUEST_WIFI_DISCONNECT). */
  leave(): void {
    wifiDisconnect();
  }

  /** True once IP connectivity is up (the L4 flag — post-DHCP, or after
   *  static IPv4 facts are applied). */
  linked(): boolean {
    return wifiIsConnected();
  }

  /** Signal strength in dBm (iface-status query). */
  rssi(): number {
    return wifiRssi();
  }

  /** The interface's global IPv4 address as text ("0.0.0.0" when down). */
  ip(): string {
    return wifiLocalIp();
  }

  /** The radio's BSSID packed into a number (iface-status query). */
  mac(): number {
    return wifiMac();
  }

  /** Fires once DHCP (or static config) assigns an address. */
  onUp(handler: () => void): void {
    wifiOnEvent('connect', callback(handler));
  }

  /** Fires on link loss (deferred off the net_mgmt event chain so the
   *  callback may safely call join()). */
  onDrop(handler: () => void): void {
    wifiOnEvent('disconnect', callback(handler));
  }

  /** One blocking scan; read the results through the returned handle.
   *  Fixed pool of 16 — no heap. */
  scan(): Scan {
    wifiScan();
    return new Scan();
  }
}

/** Read-only view over the last scan's fixed result pool. */
export class Scan {
  /** Number of networks found. */
  count(): number {
    return wifiScanCount();
  }

  /** Network name ("" when out of range). */
  ssid(i: number): string {
    return wifiScanSsid(i);
  }

  /** Signal strength in dBm. */
  rssi(i: number): number {
    return wifiScanRssi(i);
  }

  /** Security family as text: "open" / "wpa" / "wpa2" / "wpa3". */
  security(i: number): string {
    return wifiScanEncryption(i);
  }

  /** Channel number (0 when unknown). */
  channel(i: number): number {
    return wifiScanChannel(i);
  }
}

/** SoftAP — the AP facts at construction, then start/stop. */
export class WiFiAP {
  private readonly _ssid: string;
  private readonly _psk: string | undefined;
  private readonly _channel: number;

  /** Construct an AP. `psk` omitted → open network. `channel` 0 = auto. */
  constructor(ssid: string, opts: { psk?: string; channel?: number } = {}) {
    this._ssid = ssid;
    this._psk = opts.psk;
    this._channel = opts.channel ?? 0;
  }

  /** Bring the interface up as an AP (NET_REQUEST_WIFI_AP_ENABLE). */
  start(): void {
    wifiApStart(this._ssid, this._psk, this._channel);
  }

  /** Tear the AP down (NET_REQUEST_WIFI_AP_DISABLE). */
  stop(): void {
    wifiApStop();
  }
}
