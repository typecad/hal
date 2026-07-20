import {
  wifiConnect,
  wifiConnectStart,
  wifiDisconnect,
  wifiStatus,
  wifiIsConnected,
  wifiLocalIp,
  wifiRssi,
  wifiMac,
  wifiSetHostname,
  wifiSetStaticIp,
  wifiSetAutoReconnect,
  wifiSetPowerSave,
  wifiSetTxPower,
  wifiOnEvent,
  wifiApStart,
  wifiApStop,
  wifiApClientCount,
  wifiApIp,
  wifiApSetChannel,
  wifiApSetHidden,
  wifiApSetMaxClients,
  wifiScan,
  wifiScanStart,
  wifiScanCount,
  wifiScanSsid,
  wifiScanRssi,
  wifiScanEncryption,
  wifiScanChannel,
  wifiSaveCredentials,
  wifiConnectSaved,
  wifiClearCredentials,
  wifiWaitConnected,
  wifiWaitDisconnected,
} from './emit.js';
import { callback } from './callback.js';

/** Normalized WiFi link status (mapped from esp_wifi events by the runtime shim). */
export enum WiFiStatus {
  Idle = 0,
  Connecting = 1,
  Connected = 2,
  ConnectFailed = 3,
  Disconnected = 4,
}

export enum WiFiEncryption {
  Open = 0,
  WEP = 1,
  WPA = 2,
  WPA2 = 3,
  WPA3 = 4,
  Enterprise = 5,
}

/**
 * WiFi radio / link control, lowered to native ESP-IDF (`esp_wifi` /
 * `esp_netif` / `esp_event` / `nvs_flash`) by framework-esp32.
 *
 * No `include()` calls here — ESP-IDF headers are framework-owned and added
 * via forcedIncludes when the program uses wifi.* ops (the Preferences
 * lesson: HAL files must not carry platform headers). Frameworks without a
 * wifi lowering reject these ops with a diagnostic.
 */
export class WiFiClass {
  static readonly __instance_name = "WiFi";

  /** Blocking at top level; cooperatively awaitable inside async functions. */
  connect(ssid: string, password?: string, timeoutMs: number = 15000): Promise<boolean> {
    wifiConnect(ssid, password, timeoutMs);
    return Promise.resolve(false);
  }

  /** Fire-and-forget STA begin; poll status() / untilConnected(). */
  connectAsync(ssid: string, password?: string): void {
    wifiConnectStart(ssid, password);
  }

  untilConnected(timeoutMs: number = 15000): Promise<boolean> {
    wifiWaitConnected(timeoutMs);
    return Promise.resolve(false);
  }

  untilDisconnected(): Promise<void> {
    wifiWaitDisconnected();
    return Promise.resolve();
  }

  disconnect(): void {
    wifiDisconnect();
  }

  isConnected(): boolean {
    return wifiIsConnected();
  }

  status(): WiFiStatus {
    return wifiStatus() as WiFiStatus;
  }

  localIP(): string {
    return wifiLocalIp();
  }

  rssi(): number {
    return wifiRssi();
  }

  macAddress(): string {
    return wifiMac();
  }

  hostname(name: string): this {
    wifiSetHostname(name);
    return this;
  }

  staticIP(ip: string, gateway: string, subnet: string, dns?: string): this {
    wifiSetStaticIp(ip, gateway, subnet, dns);
    return this;
  }

  autoReconnect(enabled: boolean): this {
    wifiSetAutoReconnect(enabled);
    return this;
  }

  powerSave(mode: "default" | "none"): this {
    wifiSetPowerSave(mode);
    return this;
  }

  /** Cap TX power in dBm (roughly 2–20). Safe to call before connect() —
   *  the value is applied after the radio starts. */
  txPower(dbm: number): this {
    wifiSetTxPower(dbm);
    return this;
  }

  saveCredentials(ssid: string, password: string): void {
    wifiSaveCredentials(ssid, password);
  }

  connectSaved(timeoutMs: number = 15000): boolean {
    return wifiConnectSaved(timeoutMs);
  }

  clearCredentials(): void {
    wifiClearCredentials();
  }

  onConnect(handler: () => void): void {
    wifiOnEvent("connect", callback(handler));
  }

  onDisconnect(handler: () => void): void {
    wifiOnEvent("disconnect", callback(handler));
  }

  onGotIP(handler: () => void): void {
    wifiOnEvent("got_ip", callback(handler));
  }

  startAP(ssid: string, password?: string): boolean {
    return wifiApStart(ssid, password);
  }

  apChannel(ch: number): this {
    wifiApSetChannel(ch);
    return this;
  }

  apHidden(hidden: boolean): this {
    wifiApSetHidden(hidden);
    return this;
  }

  apMaxClients(n: number): this {
    wifiApSetMaxClients(n);
    return this;
  }

  stopAP(): void {
    wifiApStop();
  }

  apClientCount(): number {
    return wifiApClientCount();
  }

  apIP(): string {
    return wifiApIp();
  }

  scan(): number {
    return wifiScan();
  }

  scanAsync(): Promise<void> {
    wifiScanStart();
    return Promise.resolve();
  }

  scanCount(): number {
    return wifiScanCount();
  }

  scanSSID(i: number): string {
    return wifiScanSsid(i);
  }

  scanRSSI(i: number): number {
    return wifiScanRssi(i);
  }

  scanEncryption(i: number): WiFiEncryption {
    return wifiScanEncryption(i) as WiFiEncryption;
  }

  scanChannel(i: number): number {
    return wifiScanChannel(i);
  }
}

export const WiFi = new WiFiClass();
