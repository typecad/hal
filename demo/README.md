# Relay — cuttlefish demo

A deterministic **packet-router simulation** written in idiomatic TypeScript and
transpiled to C++ by cuttlefish (`@typecad/framework-native`). A 4×4 grid of
network nodes injects one packet per tick from the source (top-left) toward the
sink (bottom-right). Each packet is forwarded hop-by-hop through a routing
table that picks the direction reducing Manhattan distance, until delivered or
a hop budget is exhausted. Payloads are bitwise-packed/unpacked and CRC-8
checksummed. The run is fully deterministic (seeded RNG) and reports delivery
stats, hop counts, and checksum aggregates.

This is the **fifth** demo iteration. Each iteration targets a different
SUPPORT_MATRIX slice. Demo #5 exercises **typed arrays** (`Uint8Array`),
**bitwise operators** (`& | ^ << >>` and compound assignment), **`const enum`**
flag composition, **2D arrays** (`Node[][]`), **`do...while`**, and
**object destructuring** — a slice not covered by Demos #3–#4.

## Layout

```
demo/src/
  models/
    Types.ts        const enums (NodeKind, LinkFlag flag bits), interfaces
                    (Point, Node, Packet, RouteEntry), tunables, flag() helper
    Network.ts      grid construction, routing table, hop forwarding
                    (2D arrays, Map routing table, bitwise flag composition,
                    object destructuring of RouteEntry)
  services/
    Rng.ts          seeded splitmix32 (uint32_t-annotated, bitwise mix)
    Crc.ts          CRC-8 (bitwise-heavy), pack32/unpack32Into, popcount
  main.ts           sim driver (do...while injection loop, inline stats,
                    top-level -> main())
```

## Running

```bash
npm run compile      # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/Crc.exe
```

`npm run compile` exits 0. Zero g++ errors, zero g++ warnings. Only the
transpiler's own advisory diagnostics (none significant) appear.

## Sample output

```
=== RELAY sim complete ===
ticks=24 grid=4x4
delivered=24 dropped=0
total_hops=144 avg_hops=6
manhattan_lower_bound=6
crc_sum=3109 set_bits=103
source_outbound_links=2 sink_inbound_links=2
```

All 24 packets deliver. `avg_hops=6` equals the `manhattan_lower_bound=6`, so
routing is optimal (each packet takes a shortest path). Deterministic and
reproducible (seed `0x1234567`).

## SUPPORT_MATRIX patterns exercised

| Area | Pattern | Source |
|---|---|---|
| §1.1 | `let`/`const`, multiple decls | throughout |
| §1.2 | `uint8_t`/`uint32_t`/`int16_t` pass-through | `Rng`, `Crc`, `Types` |
| §1.5 | `Uint8Array` literals + element access | `Crc.unpack32Into`, payload build |
| §1.5 | 2D arrays `Node[][]` (🟡) | `Network.buildNetwork`, `forward` |
| §1.5 | `Map<int16, RouteEntry>` | `buildRoutingTable`, `forward` |
| §1.6 | `interface` → `struct` | `Point`, `Node`, `Packet`, `RouteEntry` |
| §1.7 | `const enum` (NodeKind, LinkFlag), enum comparison (`===`) | dispatch throughout |
| §1.9 | object destructuring | `forward` (`const { to, via } = entry`) |
| §1.10 | `Map.has` | `forward` |
| §2.1 | `if`/`else if`/`else`, ternary | `routeFor`, `buildNetwork` |
| §2.2 | `for`, `for...of`, `do...while`, `while` | injection loop, forwarding |
| §4.1 | class, static factory, private field | `Rng` |
| §5.1 | bitwise `& \| ^ << >>`, compound `<<= \|= ^=` | `Crc.crc8`, `pack32`, `routeFor` |
| §5.2 | `Math.floor` | avg-hops rounding |
| §6.1 | top-level → `main()` | `main.ts` |
| §6.2 | multi-file local imports | every file |

---

# Transpilation issues encountered (Demo #5)

Demo #5 surfaced six distinct transpilation issues. Each was triaged against
the SUPPORT_MATRIX: the one bug in a supported (✅) pattern was **fixed in the
transpiler**; the typed-array lifetime gaps (no realistic C++ lowering without
heap semantics) were **guarded by ESLint rules**; and one TS-only shape was a
**source workaround**.

## Fixed in the transpiler (supported pattern)

### Bitwise operators on enum-class operands (`renderBinary`)
`flags | LinkFlag.Up`, `from.links[0] & LinkFlag.Wired`, `m ^ Mode.A` all
emitted the raw enum operands and failed g++ (`no match for 'operator|'
('LinkFlag' and 'LinkFlag')`). SUPPORT_MATRIX §5.1 lists bitwise `& | ^ ~ << >>`
as ✅, but the existing `static_cast<int>` enum wrapping (added in Demo #4 for
arithmetic and comparison) did **not** cover bitwise operators. Flag-bit enums
— a common embedded idiom for register/interrupt masks — could not compose.
**Fix:** `packages/cuttlefish/src/emit/expression-renderer.ts` `renderBinary`
now has a dedicated bitwise-ops block that wraps enum operands in
`static_cast<int>` (with the same defensive-symmetric casting as the arithmetic
and comparison blocks). Pinned by 3 regression tests in
`tests/demo-5-regressions.test.ts`.

## Guarded by ESLint rules (no realistic C++ lowering)

These patterns cannot be transpiled to *correct* C++ and are now rejected at
lint time (in `eslint-transpiler-rules.mjs` + `demo/eslint.config.mjs`):

### Typed-array parameter `.length`
`.length` on a typed-array **parameter** lowers to `param.size()` on a raw
`uint8_t*` (pointers have no `.size()`; the SUPPORT_MATRIX §1.5
`sizeof/sizeof` lowering only works for stack arrays, not decayed parameters).
New plugin rule `cuttlefish/no-typed-array-param-length` flags `.length` on any
parameter whose type annotation is a typed array. **Workaround:** pass the
length as an explicit `number` parameter (as `crc8(data, len)` now does).

### Returning a typed array from a function
A function that `return`s a typed array lowers to returning a pointer to a
**stack-local** C array, which dangles the moment the function returns — the
caller dereferences freed stack memory (undefined behavior; in this demo it
crashed with a 0xC0000005 access violation). TS typed arrays are heap objects
with value semantics; the C-style stack-array lowering cannot model the
lifetime. New plugin rule `cuttlefish/no-typed-array-return` flags any
function/method with a typed-array return-type annotation. **Workaround:** write
into a caller-provided output-array parameter (as `unpack32Into(v, out)` now
does, replacing the old `unpack32` that returned a `Uint8Array`).

> **Note on the broader typed-array lifetime gap:** the same root cause affects
> a typed array *stored in a struct field* that outlives its declaring scope
> (e.g. a `Node` with a `links: Uint8Array` field, where the node is pushed
> into a vector that outlives the loop). That shape is harder to detect
> generically (the lint rule would need cross-scope alias analysis), so it is
> documented here rather than lint-guarded. The demo avoids it by using four
> scalar `uint8_t` fields (`up`/`right`/`down`/`left`) on `Node` instead of a
> typed array.

## Source workarounds (not transpiler bugs)

- **`Owned<T>` alias** (`type OwnedGrid = Owned<Grid>`) — generic/phantom type
  aliases are not emitted as C++ typedefs (the Demo #4 lint rule already
  covers this family). The demo inlines `Node[][]` at each use site.
- **`RouteEntry !== undefined`** on `Map.get` — the Demo #4 lint rule
  `cuttlefish/no-undefined-compare-on-get` guards this. The demo uses `.has()`.
- **Arrow IIFE** `(() => { ... })()` — SUPPORT_MATRIX §3.4 lists
  `function`-expression IIFEs as ✅, but an *arrow* IIFE emits the `=>` syntax
  literally. The demo uses a named helper (`sumHops`, then inlined further).
- **enum → narrower-int assignment** (`links[0] = LinkFlag.Wired`) — C++ `enum
  class` won't implicitly convert to `uint8_t`. The §5.1 bitwise fix casts enum
  operands in *expressions*, but assignment-to-a-narrower-lvalue is a source
  intent decision. The demo uses a `flag(LinkFlag.X): int16_t` helper.

## Build verdict

- **`npm run compile` exits 0.** Zero g++ errors, zero g++ warnings.
- **The produced `Crc.exe` runs correctly** with deterministic output: all 24
  packets deliver (`delivered=24`), average hops equals the Manhattan lower
  bound (`avg_hops=6`), CRC/bit aggregates are sensible.
- **Full test suite: 981 passed, 0 failed, 19 skipped** — the 3 new
  regression tests pin the bitwise-enum fix; the existing 978 are unchanged.
