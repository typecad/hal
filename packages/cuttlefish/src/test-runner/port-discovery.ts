// ---------------------------------------------------------------------------
// cuttlefish test-runner — USB identity port discovery
//
// Multi-board rigs (e.g. a nightly test box) cannot track COM/tty numbers:
// they reshuffle on every replug and every CDC re-enumeration after a flash.
// Boards are instead identified by their USB VID/PID (+ optional serial
// number), declared per board in test-pins.json (`usb: { vid, pid, serial? }`)
// or directly in the config's `test.usb`. Zephyr CDC consoles all enumerate
// at the Zephyr-test default identity 0x2FE3:0001 (per-board PIDs are no
// longer assigned), so vid/pid alone cannot distinguish several attached CDC
// boards — run one CDC board at a time, or disambiguate via `serial` when the
// descriptor provides one.
//
// UART-bridge boards identify by their bridge chip instead: the Uno's 16U2
// (2341:0043, CH340 clones report 1A86:7523) and the ESP32 DevKitC's CP2102
// (10C4:EA60). Those bridges report real unique serial numbers, so several
// identical devkits disambiguate via `serial`.
// ---------------------------------------------------------------------------

/** A USB identity to match attached serial ports against. */
export interface UsbIdentity {
  /** Vendor ID, 4 hex digits (with or without 0x, case-insensitive). */
  vid: string;
  /** Product ID, 4 hex digits (with or without 0x, case-insensitive). */
  pid: string;
  /** Optional exact serial-number match — disambiguates identical devices. */
  serial?: string;
}

/** One attached USB serial port, normalized from serialport's listing. */
export interface UsbSerialPort {
  path: string;
  vid: string;
  pid: string;
  serialNumber?: string;
  manufacturer?: string;
}

/** Normalize a hex id: strip 0x, lowercase, pad to 4 digits. */
export function normalizeHexId(value: string): string {
  const stripped = value.trim().toLowerCase().replace(/^0x/, '');
  return stripped.padStart(4, '0');
}

/** Normalize an identity's fields (returns a new object). */
export function normalizeUsbIdentity(identity: UsbIdentity): UsbIdentity {
  return {
    vid: normalizeHexId(identity.vid),
    pid: normalizeHexId(identity.pid),
    ...(identity.serial ? { serial: identity.serial } : {}),
  };
}

/** Human-readable one-line form: `2FE3:0001 (serial DF7A…)` / `2FE3:0001`. */
export function formatUsbIdentity(identity: UsbIdentity): string {
  const n = normalizeUsbIdentity(identity);
  return `${n.vid.toUpperCase()}:${n.pid.toUpperCase()}${n.serial ? ` serial ${n.serial}` : ''}`;
}

/** Format the attached-port table for diagnostics (nightly logs). */
export function formatPortTable(ports: UsbSerialPort[]): string {
  if (ports.length === 0) return '  (no USB serial ports found)';
  const rows = ports.map((p) => {
    const id = `${p.vid.toUpperCase()}:${p.pid.toUpperCase()}`;
    const serial = p.serialNumber ? ` serial ${p.serialNumber}` : '';
    const mfr = p.manufacturer ? ` [${p.manufacturer}]` : '';
    return `  ${p.path}  ${id}${serial}${mfr}`;
  });
  return rows.join('\n');
}

/**
 * Enumerate attached USB serial ports (ports without a USB identity, such as
 * legacy motherboard COM ports, are skipped). Uses a dynamic import so the
 * native serialport dependency loads only when discovery runs.
 */
export async function listUsbSerialPorts(): Promise<UsbSerialPort[]> {
  const { SerialPort } = await import('serialport');
  const ports = await SerialPort.list();
  const result: UsbSerialPort[] = [];
  for (const p of ports) {
    if (!p.vendorId || !p.productId || !p.path) continue;
    result.push({
      path: p.path,
      vid: normalizeHexId(p.vendorId),
      pid: normalizeHexId(p.productId),
      ...(p.serialNumber ? { serialNumber: p.serialNumber } : {}),
      ...(p.manufacturer ? { manufacturer: p.manufacturer } : {}),
    });
  }
  return result;
}

/**
 * Pure matcher: which of `ports` match `identity`. VID/PID must match; when
 * the identity carries a serial, it must match exactly (the disambiguator
 * for several identical bridge chips).
 */
export function matchUsbPorts(ports: UsbSerialPort[], identity: UsbIdentity): UsbSerialPort[] {
  const n = normalizeUsbIdentity(identity);
  return ports.filter((p) =>
    p.vid === n.vid
    && p.pid === n.pid
    && (n.serial === undefined || p.serialNumber === n.serial)
  );
}

export interface ResolveResult {
  /** Resolved port path on success. */
  port?: string;
  /** Failure reason when no port could be resolved. */
  error?: string;
}

/**
 * Resolve the port for an identity: exactly one match, or an error naming
 * the problem AND the full attached-port table (a nightly log should show
 * what IS connected, not just that something is missing).
 */
export async function resolveUsbPort(identity: UsbIdentity): Promise<ResolveResult> {
  const ports = await listUsbSerialPorts();
  const matches = matchUsbPorts(ports, identity);

  if (matches.length === 1) return { port: matches[0].path };

  const wanted = formatUsbIdentity(identity);
  if (matches.length === 0) {
    return {
      error: `No USB serial port matches ${wanted}. Attached ports:\n${formatPortTable(ports)}`,
    };
  }
  return {
    error: `Multiple ports match ${wanted} — add a serial number to disambiguate. Matches:\n${
      formatPortTable(matches)
    }\nAll attached ports:\n${formatPortTable(ports)}`,
  };
}

/**
 * Wait for a port matching the identity to (re-)appear — CDC consoles
 * re-enumerate after a flash and may come back under a different COM
 * number. Polls after an initial settle delay; returns undefined on timeout.
 */
export async function waitForUsbPort(
  identity: UsbIdentity,
  settleMs: number,
  pollMs = 500,
  maxWaitMs = 10_000,
): Promise<string | undefined> {
  if (settleMs > 0) await sleep(settleMs);
  const deadline = Date.now() + Math.max(maxWaitMs - settleMs, 0);
  for (;;) {
    const result = await resolveUsbPort(identity);
    if (result.port) return result.port;
    if (Date.now() >= deadline) return undefined;
    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
