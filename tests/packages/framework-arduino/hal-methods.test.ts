import { describe, expect, it } from "vitest";
import { ArduinoStrategy } from "../../../packages/framework-arduino/src";

describe("ArduinoStrategy atomic HAL methods", () => {
  const s = new ArduinoStrategy();

  it("readDigitalPin emits digitalRead", () => {
    expect(s.readDigitalPin!("7")).toBe("digitalRead(7)");
  });
  it("readAnalogPin emits analogRead", () => {
    expect(s.readAnalogPin!("A0")).toBe("analogRead(A0)");
  });
  it("writeDigitalPin emits digitalWrite", () => {
    expect(s.writeDigitalPin!("7", "HIGH")).toBe("digitalWrite(7, HIGH)");
  });
  it("setPinMode emits pinMode", () => {
    expect(s.setPinMode!("7", "OUTPUT")).toBe("pinMode(7, OUTPUT)");
  });
  it("delayMs emits delay", () => {
    expect(s.delayMs!("100")).toBe("delay(100)");
  });
  it("delayMicroseconds emits delayMicroseconds", () => {
    expect(s.delayMicroseconds!("10")).toBe("delayMicroseconds(10)");
  });

  it("halCallNames includes the core Arduino HAL surface", () => {
    const names = s.halCallNames!();
    expect(names.has("digitalRead")).toBe(true);
    expect(names.has("analogRead")).toBe(true);
    expect(names.has("digitalWrite")).toBe(true);
    expect(names.has("Serial")).toBe(true);
    expect(names.has("millis")).toBe(true);
    expect(names.has("delay")).toBe(true);
  });

  it("isHalCall recognizes HAL names", () => {
    expect(s.isHalCall!("digitalRead")).toBe(true);
    expect(s.isHalCall!("myFunc")).toBe(false);
  });

  it("analogReadCallNames includes analogRead", () => {
    expect(s.analogReadCallNames!().has("analogRead")).toBe(true);
  });
});
