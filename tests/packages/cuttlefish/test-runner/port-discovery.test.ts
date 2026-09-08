import { describe, it, expect } from "vitest";
import {
  normalizeHexId,
  normalizeUsbIdentity,
  formatUsbIdentity,
  formatPortTable,
  matchUsbPorts,
  type UsbSerialPort,
} from "../../../../packages/cuttlefish/src/test-runner/port-discovery";

// The matcher is pure (list + identity -> matches) so multi-board rig
// semantics are unit-testable without hardware. Serialport's list() reports
// vendorId/productId as bare lowercase hex, sometimes unpadded.

const PORTS: UsbSerialPort[] = [
  { path: "COM1", vid: "2fe3", pid: "0002", serialNumber: "DEV-A", manufacturer: "Zephyr" },
  { path: "COM2", vid: "2fe3", pid: "0003", serialNumber: "DEV-B" },
  { path: "COM3", vid: "2fe3", pid: "0002", serialNumber: "DEV-C" },
  { path: "COM4", vid: "10c4", pid: "ea60", serialNumber: "0001", manufacturer: "Silicon Labs" },
  { path: "/dev/ttyACM0", vid: "2341", pid: "0043" }, // no serial (e.g. a 16U2 that reports none)
];

describe("normalizeHexId", () => {
  it("strips 0x, lowercases, and pads to 4 digits", () => {
    expect(normalizeHexId("2FE3")).toBe("2fe3");
    expect(normalizeHexId("0x2FE3")).toBe("2fe3");
    expect(normalizeHexId("ea60")).toBe("ea60");
    expect(normalizeHexId("3a")).toBe("003a");
  });
});

describe("matchUsbPorts", () => {
  it("matches by VID/PID regardless of formatting", () => {
    const matches = matchUsbPorts(PORTS, { vid: "0x10C4", pid: "EA60" });
    expect(matches.map((m) => m.path)).toEqual(["COM4"]);
  });

  it("matches the board's per-board Zephyr PID", () => {
    const matches = matchUsbPorts(PORTS, { vid: "2FE3", pid: "0003" });
    expect(matches.map((m) => m.path)).toEqual(["COM2"]);
  });

  it("returns every same-VID/PID device when no serial is given (ambiguity is the caller's error)", () => {
    const matches = matchUsbPorts(PORTS, { vid: "2fe3", pid: "0002" });
    expect(matches.map((m) => m.path)).toEqual(["COM1", "COM3"]);
  });

  it("disambiguates identical devices by exact serial", () => {
    expect(matchUsbPorts(PORTS, { vid: "2FE3", pid: "0002", serial: "DEV-C" }).map((m) => m.path))
      .toEqual(["COM3"]);
    expect(matchUsbPorts(PORTS, { vid: "2FE3", pid: "0002", serial: "nope" })).toEqual([]);
  });

  it("matches devices with no serial when the identity has none", () => {
    expect(matchUsbPorts(PORTS, { vid: "2341", pid: "0043" }).map((m) => m.path))
      .toEqual(["/dev/ttyACM0"]);
  });
});

describe("formatting", () => {
  it("formatUsbIdentity renders VID:PID and serial", () => {
    expect(formatUsbIdentity({ vid: "2fe3", pid: "2" })).toBe("2FE3:0002");
    expect(formatUsbIdentity({ vid: "2FE3", pid: "0002", serial: "DEV-A" })).toBe("2FE3:0002 serial DEV-A");
  });

  it("formatPortTable lists every port with its identity", () => {
    const table = formatPortTable(PORTS);
    expect(table).toContain("COM1  2FE3:0002 serial DEV-A [Zephyr]");
    expect(table).toContain("/dev/ttyACM0  2341:0043");
    expect(formatPortTable([])).toBe("  (no USB serial ports found)");
  });

  it("normalizeUsbIdentity normalizes without mutating the input", () => {
    const identity = { vid: "0x2FE3", pid: "2" };
    expect(normalizeUsbIdentity(identity)).toEqual({ vid: "2fe3", pid: "0002" });
    expect(identity).toEqual({ vid: "0x2FE3", pid: "2" });
  });
});
