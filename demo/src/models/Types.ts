// ---------------------------------------------------------------------------
// Types.ts — shared types, const enum, interfaces, and tunables for Relay.
//
// SUPPORT_MATRIX tour for Demo #5:
//   §1.7  const enum (first use in a demo), numeric enum with bit flags
//   §1.6  interfaces → structs
//   §1.5  typed-array type annotations (Uint8Array, Int16Array)
//   §1.1  top-level const tunables
// ---------------------------------------------------------------------------

// §1.7 — const enum. Transpiles to a plain C++ enum class with inlined values.
export const enum NodeKind {
  Router = 0,
  Sink = 1,
  Source = 2,
}

// §1.7 — a flag-bit enum. Members are powers of two so they compose with
// bitwise OR (§5.1 bitwise assignment is exercised on these in Routing.ts).
export const enum LinkFlag {
  None = 0,
  Up = 1,
  Right = 2,
  Down = 4,
  Left = 8,
  Wired = 16,
}

// §1.6 — a grid position. Fields are int16 to match the typed-array coordinate
// storage used elsewhere.
export interface Point {
  x: int16_t;
  y: int16_t;
}

// §1.6 — a network node. Link state is stored as four plain uint8_t fields
// (up/right/down/left) rather than a Uint8Array. A typed-array struct field
// lowers to a C-style stack array, which dangles once the declaring scope
// exits (the array is stored by decayed pointer, not by value). Plain scalar
// fields copy safely into vectors/structs that outlive their constructor.
export interface Node {
  id: int16_t;
  kind: NodeKind;
  pos: Point;
  up: uint8_t;
  right: uint8_t;
  down: uint8_t;
  left: uint8_t;
}

// §1.6 — a packet in flight. `cur` tracks the current node id (advances each
// hop); `src` is the original source (constant). No payload field — a
// Uint8Array-typed field would lower to a stack-array pointer that dangles
// once the declaring scope exits (the typed-array lifetime gap). The payload
// is kept as a local in the injection loop and the CRC is computed inline.
export interface Packet {
  src: int16_t;
  cur: int16_t;
  dst: int16_t;
  hops: int16_t;
  delivered: boolean;
}

// §1.6 — a routing-table row: destination node id → outbound link flags.
// `via` is an int16 bitmask (LinkFlag values OR'd together) rather than a
// LinkFlag-typed field, because enum-class bitwise assignment-back would need
// a renderer-invisible back-cast. A plain int accumulator composes cleanly.
export interface RouteEntry {
  to: int16_t;
  via: int16_t;
}

// Tunables (§1.1 top-level const).
export const GRID_W: int16_t = 4;
export const GRID_H: int16_t = 4;
export const MAX_TICKS: int16_t = 24;
export const PAYLOAD_LEN: int16_t = 4;

// CRC-8 polynomial bitmask (§5.1 bitwise ops).
export const CRC_POLY: uint8_t = 0x07;

// Convert a LinkFlag enum value to its plain int16 bit value. Used when
// storing a flag into a struct field of non-enum type (`up: uint8_t =
// flag(LinkFlag.Wired)`): C++ `enum class` won't implicitly convert to
// uint8_t. The operator-level enum-cast fix (Demo #5) covers enum operands in
// expressions, but assignment-to-a-narrower-lvalue is a source intent decision
// the renderer can't infer (it can't see the target type), so we convert here.
export function flag(f: LinkFlag): int16_t {
  switch (f) {
    case LinkFlag.None:
      return 0;
    case LinkFlag.Up:
      return 1;
    case LinkFlag.Right:
      return 2;
    case LinkFlag.Down:
      return 4;
    case LinkFlag.Left:
      return 8;
    case LinkFlag.Wired:
      return 16;
    default:
      return 0;
  }
}
