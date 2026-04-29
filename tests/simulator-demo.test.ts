// ---------------------------------------------------------------------------
// Simulator Demo: Testing firmware logic without physical hardware
//
// This file demonstrates the value of software-defined hardware simulation.
// Instead of wiring up breadboards, flashing microcontrollers, and manually 
// testing scenarios, we can simulate the hardware in software and write 
// automated tests to prove our logic works perfectly.
//
// Scenario: A simple "Smart Door Alarm"
// - Reads a digital pin connected to a door sensor (magnetic switch)
// - Drives a digital pin connected to an alarm buzzer
//
// Run with:
//   npm run vitest tests/simulator-demo.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { attachSimulator, type SimBoard } from "@typehal/simulator";
import { Board } from "@typehal/board-arduino-uno";

// ===========================================================================
// 1. The Firmware Logic
// ---------------------------------------------------------------------------
// This is the actual logic that will run on the microcontroller. 
// We import the board singleton directly, just like real firmware!
// ===========================================================================

function runAlarmLogic() {
  // Read the physical state of the door sensor (D2).
  const isDoorOpen = Board.D2.isHigh();

  if (isDoorOpen) {
    Board.D8.high(); // Sound the alarm!
  } else {
    Board.D8.low();  // Keep quiet.
  }
}

// ===========================================================================
// 2. The Automated Tests
// ---------------------------------------------------------------------------
// Here we prove the firmware works using virtual hardware. 
// By attaching the simulator, the imported `Board` becomes fully functional!
// ===========================================================================

describe("Smart Door Alarm Firmware", () => {
  let sim: SimBoard;

  beforeEach(() => {
    // Magically patch the global Board singleton with simulated pins
    sim = attachSimulator(Board);
    sim.reset(); // Ensure a clean state for each test
  });

  it("keeps the buzzer OFF when the door is closed", () => {
    // Simulate the physical environment (Door is closed -> LOW)
    sim.digital(2).injectValue(0);

    // Run our firmware logic
    runAlarmLogic();

    // Verify the hardware responded correctly
    expect(Board.D8.isHigh()).toBe(false);
  });

  it("turns the buzzer ON when the door is opened", () => {
    // Simulate the physical environment (Door is opened -> HIGH)
    sim.digital(2).injectValue(1);

    // Run our firmware logic
    runAlarmLogic();

    // Verify the hardware responded correctly
    expect(Board.D8.isHigh()).toBe(true);
  });
  
  it("turns the buzzer OFF when the door is closed again", () => {
    // Simulate door opening
    sim.digital(2).injectValue(1);
    runAlarmLogic();
    expect(Board.D8.isHigh()).toBe(true); // Sanity check: alarm is on

    // Simulate door closing
    sim.digital(2).injectValue(0);
    runAlarmLogic();
    
    // Verify buzzer turned off
    expect(Board.D8.isLow()).toBe(true);
  });
});
