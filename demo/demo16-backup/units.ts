// ---------------------------------------------------------------------------
// units.ts — domain types and pure conversion helpers (cuttlefish demo #16).
//
// A small, idiomatic unit-converter module. The kind of thing you'd find in
// any everyday TypeScript codebase: a `const enum` of units, an interface
// describing a measurement, a lookup table built with a `Map`, and a couple of
// pure functions. Kept deliberately tiny and readable — this is *not* a
// feature-exhaustion test.
// ---------------------------------------------------------------------------

// Units we know how to convert between. `const enum` so members are inlined
// (plain `enum` is lint-gated in scaffolded projects — by design).
export const enum Unit {
  Celsius = 1,
  Fahrenheit = 2,
  Meters = 3,
  Feet = 4,
}

// A measured value together with its unit. Interface -> C++ struct.
export interface Measurement {
  value: double;
  unit: Unit;
}

// A short human-readable label for each unit. Map<Unit, string> lowers to
// std::map<int, std::string>. `let` because it is populated via .set().
function buildLabels(): Map<Unit, string> {
  let labels: Map<Unit, string> = new Map();
  labels.set(Unit.Celsius, 'C');
  labels.set(Unit.Fahrenheit, 'F');
  labels.set(Unit.Meters, 'm');
  labels.set(Unit.Feet, 'ft');
  return labels;
}

// Convert a temperature reading between Celsius and Fahrenheit.
export function convertTemperature(value: double, from: Unit): double {
  if (from === Unit.Celsius) {
    return value * 9.0 / 5.0 + 32.0;
  }
  return (value - 32.0) * 5.0 / 9.0;
}

// Convert a length between meters and feet (1 m == 3.28084 ft).
export function convertLength(value: double, from: Unit): double {
  if (from === Unit.Meters) {
    return value * 3.28084;
  }
  return value / 3.28084;
}

// Format a measurement as "valueUnit", e.g. "25.0C". Template literal +
// Map.get() lookup (lowers to const-correct .at()).
export function format(m: Measurement): string {
  const labels: Map<Unit, string> = buildLabels();
  const suffix: string = labels.get(m.unit)!;
  return `${m.value}${suffix}`;
}
