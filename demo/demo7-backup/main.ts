// ---------------------------------------------------------------------------
// main.ts — Wattage grid sim driver.
//
// SUPPORT_MATRIX tour for Demo #7:
//   §6.1  top-level statements → main()
//   §6.2  multi-file local imports
//   §1.1  let / const
//   §1.4  template literal banner
//   §1.9  array destructure + rest (splitHead), tuple destructure
//   §3.2  call a function taking an object-destructure param (scaleDemand)
//   §2.1  ternary + nested ternary (verdict)
//   §5.4  Object.keys/values consumption
//   §1.8  optional chaining + optional call
// ---------------------------------------------------------------------------

import { Grid, runGrid, outputChecksum, totalBusCapacity } from './models/Grid';
import {
  buildNodes,
  buildEdges,
  buildBusMap,
  buildTariffs,
} from './models/Topology';
import {
  splitHead,
  pairDelta,
  scaleDemand,
  ScaleOpts,
  maybeReport,
  knowsTariff,
  lossLabel,
  capacityRange,
  CIRCLE_AREA,
} from './models/Analytics';
import { sourceName, Source, Snapshot, FAULT_THRESHOLD } from './models/GridTypes';

// §1.1 — build the topology via factory functions (§3.1).
const nodes = buildNodes();
const edges = buildEdges();
const bus = buildBusMap(nodes);
const tariffs = buildTariffs();

// §4.5 — `new Grid()` returns a Grid*.
const grid = new Grid(nodes, bus, tariffs);

// §1.4 — template literal banner. §5.2 Math.PI (via CIRCLE_AREA).
console.log(`wattage: buses=${nodes.length} edges=${edges.length} area=${CIRCLE_AREA}`);

// §5.4 — Object.keys/values on a Map.
const ids = grid.busIds();
const tariffsList = grid.tariffValues();
console.log(`bus_ids=${ids.length} tariffs=${tariffsList.length}`);

// §5.3 — Object.values + forEach (via totalBusCapacity).
const busCap = totalBusCapacity(grid);
console.log(`total_bus_capacity=${busCap}`);

// §3.2 — call a function whose param is a default-value object destructure.
const opts: ScaleOpts = { factor: 0.75 };
const scaled = scaleDemand(1000, opts);
console.log(`scaled_demand=${scaled}`);

// §1.9 — splitHead (array destructure + rest).
const split = splitHead([10, 20, 30, 40]);
console.log(`head=${split.head} rest_len=${split.rest.length}`);

// §3.2 — pairDelta takes two params. §2.1 nested ternary lives inside.
const { lo, hi } = capacityRange(nodes);
const delta = pairDelta(lo, hi);
console.log(`cap_range lo=${lo} hi=${hi} pair_delta=${delta}`);

// §1.8 — optional call: maybeReport accepts a callback or null. NOTE: the
// null guard is emitted (cuttlefish_exists), but the runtime shim can't
// detect an empty std::function (it has no nullish specialization for
// std::function), so passing null still throws std::bad_function_call. Pass
// a real callback here; the null-case gap is documented in the README.
function makeReport(): string {
  return 'grid-ok';
}
const report = maybeReport(makeReport);
console.log(`report=${report}`);

// §1.10 — `in` operator on a map.
const hasSolar = knowsTariff(tariffs, Source.Solar);
console.log(`knows_solar_tariff=${hasSolar}`);

// §3.4 — named function expression value (lossLabel).
console.log(`loss_label=${lossLabel(75)}`);

// Run the simulation.
const stats: Snapshot = runGrid(grid);

// §5.3 — outputChecksum via forEach + Math.floor.
const checksum = outputChecksum(grid);
console.log(`output_checksum=${checksum}`);

// §2.1 — nested ternary to classify the run.
const ratio = stats.totalDemand > 0 ? stats.totalServed / stats.totalDemand : 0;
const verdict = ratio > FAULT_THRESHOLD ? 'healthy' : ratio > 0.5 ? 'degraded' : 'critical';

console.log(
  `done: ticks=${stats.ticksRun} served=${stats.totalServed} ` +
    `demand=${stats.totalDemand} faults=${stats.faults} balance=${stats.balance} verdict=${verdict}`,
);

// §1.7 — enum dispatch via sourceName (switch over enum).
console.log(`primary=${sourceName(Source.Solar)}`);
