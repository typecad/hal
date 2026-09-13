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

/**
 * A Wi-Fi station connection. Credentials and connection policy are set
 * at construction; `join()` connects and waits for an IP address (bounded
 * by `timeoutMs`), `linked()`/`ip()`/`rssi()` report the link,
 * `onUp()`/`onDrop()` fire on connect/disconnect, and `scan()` lists
 * nearby networks.
 */
export class WiFi {
  /** Security modes for `opts.security`. */
  static readonly OPEN = 0;
  static readonly WPA2 = 1;
  static readonly WPA3 = 2;
  static readonly WPA2_WPA3 = 3;

  /** Radio bands for `opts.band`. */
  static readonly BAND_2_4 = 0;
  static readonly BAND_5 = 1;

  /** Pass as `opts.powerSave` to disable the radio's power saving. */
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

  /** Construct a connection. `psk` omitted → open network; `security`
   *  defaults to WPA2 when a psk is given, OPEN otherwise; `channel`
   *  0/omitted = any; `timeoutMs` bounds join() (default 15 s); `ipv4`
   *  supplies a static address instead of DHCP. */
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

  /** Connect to the network and wait until traffic can flow (bounded by
   *  `timeoutMs`, keeping a mounted UI responsive while waiting). Returns
   *  true once the link and an IP address are up; false on timeout or
   *  when the board has no radio. Calling join() again re-associates. */
  join(): boolean {
    return wifiJoin(this._ssid, this._psk, this._security, this._channel,
      this._band, this._timeoutMs, this._ps, this._ipAddr, this._gateway,
      this._netmask);
  }

  /** Start connecting without waiting — poll linked(), or await join()
   *  inside an async function. */
  joinStart(): void {
    wifiConnectStart(this._ssid, this._psk);
  }

  /** Leave the network. */
  leave(): void {
    wifiDisconnect();
  }

  /** True once the network link is up and an IP address is assigned. */
  linked(): boolean {
    return wifiIsConnected();
  }

  /** Signal strength in dBm (more negative = weaker). */
  rssi(): number {
    return wifiRssi();
  }

  /** The interface's IPv4 address as text ("0.0.0.0" when down). */
  ip(): string {
    return wifiLocalIp();
  }

  /** The connected access point's MAC address, packed into a number. */
  mac(): number {
    return wifiMac();
  }

  /** Fires once the connection is up and an address is assigned. */
  onUp(handler: () => void): void {
    wifiOnEvent('connect', callback(handler));
  }

  /** Fires when the connection drops. Safe to call join() from the
   *  handler to reconnect. */
  onDrop(handler: () => void): void {
    wifiOnEvent('disconnect', callback(handler));
  }

  /** Scan for nearby networks (blocking). Read the results through the
   *  returned handle — at most 16 networks are kept. */
  scan(): Scan {
    wifiScan();
    return new Scan();
  }
}

/** Read-only view over the last scan's results (at most 16 networks). */
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

/** An access point: broadcast `ssid` and accept stations that connect. */
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

  /** Bring the access point up and start broadcasting. */
  start(): void {
    wifiApStart(this._ssid, this._psk, this._channel);
  }

  /** Stop broadcasting and tear the access point down. */
  stop(): void {
    wifiApStop();
  }
}
