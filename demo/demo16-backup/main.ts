// ---------------------------------------------------------------------------
// main.ts — unit converter driver (cuttlefish demo #16).
//
// A simple, idiomatic TypeScript program: build a small array of measurements,
// convert each one to the "other" unit, and print the before/after pairs.
// Transpiled to C++ by cuttlefish (@typecad/framework-native).
//
// This is the *sixteenth* demo iteration. Like demo #15 it is deliberately
// small and readable — real, everyday TypeScript — and is *not* a feature-
// exhaustion test. The source uses its natural idiomatic form throughout.
// ---------------------------------------------------------------------------

import { Unit, Measurement, convertTemperature, convertLength, format } from './units';

// Convert a single measurement to its counterpart unit. Numeric switch with a
// default branch — switches directly on the struct field `m.unit`.
function convert(m: Measurement): Measurement {
  switch (m.unit) {
    case Unit.Celsius:
      return { value: convertTemperature(m.value, Unit.Celsius), unit: Unit.Fahrenheit };
    case Unit.Fahrenheit:
      return { value: convertTemperature(m.value, Unit.Fahrenheit), unit: Unit.Celsius };
    case Unit.Meters:
      return { value: convertLength(m.value, Unit.Meters), unit: Unit.Feet };
    case Unit.Feet:
      return { value: convertLength(m.value, Unit.Feet), unit: Unit.Meters };
    default:
      return m;
  }
}

// Entry point.
function main(): void {
  // A handful of seed measurements. Array literal -> std::vector.
  const readings: Measurement[] = [
    { value: 25.0, unit: Unit.Celsius },
    { value: 98.6, unit: Unit.Fahrenheit },
    { value: 100.0, unit: Unit.Meters },
    { value: 5280.0, unit: Unit.Feet },
  ];

  // Convert each reading and print the before -> after pair.
  for (const m of readings) {
    const out: Measurement = convert(m);
    console.log(`${format(m)} -> ${format(out)}`);
  }

  // A tiny sanity check: round-trip 0C -> F -> C should land back near 0.
  const freezingF: double = convertTemperature(0.0, Unit.Celsius);
  const backToC: double = convertTemperature(freezingF, Unit.Fahrenheit);
  console.log(`roundtrip=${backToC}`);

  console.log('done');
}

main();
