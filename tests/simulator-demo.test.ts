// ---------------------------------------------------------------------------
// SIMULATOR DEMO: TESTING FIRMWARE WITHOUT HARDWARE
//
// This demo shows how "Software-Defined Hardware" allows you to develop and
// test firmware logic for a Smart Street Light without needing the physical
// LEDs or light sensors.
//
// Run with:
//   pnpm vitest run tests/simulator-demo.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createSimBoard, type SimAnalogPin, type SimPWMPin, type SimSerialPort } from "@typecad/simulator";

// ===========================================================================
// SECTION 1: FIRMWARE LOGIC
// ---------------------------------------------------------------------------
// This is the "brain" of our street light. It reads a sensor and adjusts
// the lamp brightness. In a real project, this logic stays the same whether
// it's running on a real chip or in this simulator.
// ===========================================================================

interface StreetLightHardware {
  sensor: SimAnalogPin;
  lamp: SimPWMPin;
  serial: SimSerialPort;
}

/**
 * Updates the light state based on current sensor readings.
 */
function tick(hw: StreetLightHardware) {
  // 1. Read the light sensor (0 = pitch black, 1023 = bright sun)
  const lightLevel = hw.sensor.readAnalog();
  
  // 2. Logic: If it's dark (< 500), turn on the lamp.
  // The darker it is, the brighter the lamp should be (proportional control).
  let brightness = 0;
  if (lightLevel < 500) {
    // Map 0..500 sensor reading to 100..0% brightness
    brightness = Math.round(((500 - lightLevel) / 500) * 100);
  }

  // 3. Command the hardware
  hw.lamp.pwm(brightness);

  // 4. Log what's happening so we can "debug" our virtual device
  hw.serial.println(`Sensor: ${lightLevel} | Lamp: ${brightness}%`);
}

// ===========================================================================
// SECTION 2: THE VIRTUAL TEST BENCH
// ---------------------------------------------------------------------------
// This function creates a virtual "Arduino Uno" and wires up our logic.
// ===========================================================================

function setupTestHarness() {
  const board = createSimBoard({ boardType: "arduino-uno" });

  const hw: StreetLightHardware = {
    sensor: board.analog(0), // Light sensor on A0
    lamp: board.pwm(9),      // LED Lamp on Pin 9
    serial: board.serial(0), // Built-in Serial
  };

  return {
    ...hw,
    // Convenience function to run one "cycle" of our firmware
    runCycle: () => tick(hw)
  };
}

// ===========================================================================
// SECTION 3: AUTOMATED SIMULATION TESTS
// ---------------------------------------------------------------------------
// These tests verify that our logic is correct by "injecting" virtual 
// environment data (light levels) and checking the resulting hardware states.
// ===========================================================================

describe("Smart Street Light (Simulator Demo)", () => {
  
  it("stays completely OFF during broad daylight", () => {
    const sim = setupTestHarness();

    // Simulate bright sunlight (max ADC value)
    sim.sensor.injectValue(1023);
    sim.runCycle();

    // Verify lamp is 0% brightness
    expect(sim.lamp.getPwmPercent()).toBe(0);
    expect(sim.serial.peekTxAsString()).toContain("Lamp: 0%");
  });

  it("turns ON gradually as it gets darker (50% brightness at sunset)", () => {
    const sim = setupTestHarness();

    // Simulate "sunset" (250 is half-way between 0 and our 500 threshold)
    sim.sensor.injectValue(250);
    sim.runCycle();

    // Verify lamp is at half power
    expect(sim.lamp.getPwmPercent()).toBe(50);
    expect(sim.serial.peekTxAsString()).toContain("Lamp: 50%");
  });

  it("runs at FULL brightness in pitch black", () => {
    const sim = setupTestHarness();

    // Simulate midnight (0 reading)
    sim.sensor.injectValue(0);
    sim.runCycle();

    // Verify lamp is at max power
    expect(sim.lamp.getPwmPercent()).toBe(100);
    expect(sim.serial.peekTxAsString()).toContain("Lamp: 100%");
  });

  it("recovers and turns back off when light returns", () => {
    const sim = setupTestHarness();

    // First it's dark...
    sim.sensor.injectValue(0);
    sim.runCycle();
    expect(sim.lamp.getPwmPercent()).toBe(100);

    // Then the sun comes up!
    sim.sensor.injectValue(800);
    sim.runCycle();

    // Should turn back off
    expect(sim.lamp.getPwmPercent()).toBe(0);
    expect(sim.serial.peekTxAsString()).toContain("Lamp: 0%");
  });

});
