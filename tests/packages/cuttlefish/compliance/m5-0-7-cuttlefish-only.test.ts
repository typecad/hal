import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../../packages/cuttlefish/src/api/shared/display-adapter";
import { ArduinoStrategy } from "../../../../packages/framework-arduino/src";

/**
 * Track 3 — M5-0-7 cuttlefish-only sweep: gating test.
 *
 * The display adapter shims historically used C-style casts like
 * `(uint16_t)color`. After the hand-conversion, every cast in the
 * adapter output must be `static_cast<T>(...)`.
 *
 * This test calls generateDisplayAdapter directly (the unit that produces
 * the shim text) and asserts no C-style cast of a primitive type remains.
 * It runs across multiple driver variants so every adapter is covered.
 *
 * Note: the Adafruit adapters (st7796, ssd1309) moved to framework-arduino
 * (strategy-owned), so those cases pass an ArduinoStrategy. The eink-mono
 * adapter is framework-agnostic and stays in cuttlefish's built-in registry.
 */
const arduino = new ArduinoStrategy();
const C_STYLE_CAST = /(^|[^:\w.])\(\s*(uint16_t|uint8_t|int16_t|int8_t|uint32_t|int32_t|double|float|bool|size_t|int|char|long|short)\s*\)\s*[a-zA-Z_(]/g;
const EXEMPT = /static_cast|dynamic_cast|reinterpret_cast|const_cast/;

function findCStyleCasts(cpp: string): string[] {
  const lines = cpp.split("\n");
  const offenders: string[] = [];
  for (const line of lines) {
    if (EXEMPT.test(line)) continue;
    const matches = line.match(C_STYLE_CAST);
    if (matches) offenders.push(...matches.map((m) => m.trim()));
  }
  return offenders;
}

function joinAdapterText(adapter: { functions?: string | string[]; includes?: string[]; declaration?: string }): string {
  const fns = Array.isArray(adapter.functions) ? adapter.functions.join("\n") : (adapter.functions ?? "");
  return [
    ...(adapter.includes ?? []),
    adapter.declaration ?? "",
    fns,
  ].join("\n");
}

const baseDriverSpec = {
  width: 320,
  height: 480,
  colorFormat: "rgb565" as const,
  rotation: 1,
  spiFrequency: 80000000,
  _mountCs: 5,
  _mountDc: 17,
  _mountRst: 16,
  _mountBus: "SPI",
  _mountAddress: 0x3C,
  _mountReset: -1,
};

describe("M5-0-7: cuttlefish display adapters have no C-style casts", () => {
  it("st7796 driver shim has no C-style casts", () => {
    const adapter = generateDisplayAdapter({ ...baseDriverSpec, driver: "st7796" } as any, arduino);
    const offenders = findCStyleCasts(joinAdapterText(adapter));
    expect(offenders, `C-style casts in st7796:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("ssd1309 driver shim has no C-style casts", () => {
    const adapter = generateDisplayAdapter({ ...baseDriverSpec, driver: "ssd1309" } as any, arduino);
    const offenders = findCStyleCasts(joinAdapterText(adapter));
    expect(offenders, `C-style casts in ssd1309:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("eink-mono (ssd1680) driver shim has no C-style casts", () => {
    const adapter = generateDisplayAdapter({ ...baseDriverSpec, driver: "ssd1680" } as any);
    const offenders = findCStyleCasts(joinAdapterText(adapter));
    expect(offenders, `C-style casts in ssd1680:\n${offenders.join("\n")}`).toEqual([]);
  });
});
