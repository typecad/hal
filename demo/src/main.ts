import {
  addEntry,
  receiveShipment,
  fulfillOrder,
  totalValue,
} from './inventory';
import {
  printHeader,
  printInventoryTable,
  printStats,
  printRestockReport,
  printLowStock,
  printCategory,
} from './reports';

let skus: string[] = [];
let names: string[] = [];
let categories: number[] = [];
let quantities: number[] = [];
let thresholds: number[] = [];
let unitCosts: number[] = [];
let locations: string[] = [];
let statuses: number[] = [];

let satSkus: string[] = [];
let satNames: string[] = [];
let satCategories: number[] = [];
let satQuantities: number[] = [];
let satThresholds: number[] = [];
let satUnitCosts: number[] = [];
let satLocations: string[] = [];
let satStatuses: number[] = [];

function seedMain(): void {
  addEntry(skus, names, categories, quantities, thresholds, unitCosts, locations, statuses,
    'EL-1001', 'Multimeter', 0, 45, 10, 2999, 'A-12');
  addEntry(skus, names, categories, quantities, thresholds, unitCosts, locations, statuses,
    'EL-1002', 'Soldering Iron', 0, 8, 10, 4995, 'A-14');
  addEntry(skus, names, categories, quantities, thresholds, unitCosts, locations, statuses,
    'CL-2001', 'Safety Vest', 1, 120, 20, 1250, 'B-03');
  addEntry(skus, names, categories, quantities, thresholds, unitCosts, locations, statuses,
    'CL-2002', 'Work Gloves', 1, 3, 15, 875, 'B-05');
  addEntry(skus, names, categories, quantities, thresholds, unitCosts, locations, statuses,
    'FD-3001', 'Lubricant Spray', 2, 200, 30, 699, 'C-01');
  addEntry(skus, names, categories, quantities, thresholds, unitCosts, locations, statuses,
    'TL-4001', 'Wrench Set', 3, 0, 5, 3450, 'D-08');
  addEntry(skus, names, categories, quantities, thresholds, unitCosts, locations, statuses,
    'TL-4002', 'Wire Stripper', 3, 22, 8, 1500, 'D-09');
  addEntry(skus, names, categories, quantities, thresholds, unitCosts, locations, statuses,
    'MA-5001', 'Copper Wire', 4, 500, 100, 50, 'E-01');
  addEntry(skus, names, categories, quantities, thresholds, unitCosts, locations, statuses,
    'MA-5002', 'Heat Shrink', 4, 15, 50, 225, 'E-03');
  addEntry(skus, names, categories, quantities, thresholds, unitCosts, locations, statuses,
    'EL-1003', 'Oscilloscope', 0, 2, 3, 29999, 'A-20');
}

function main(): void {
  printHeader();
  seedMain();

  console.log('\n  === DAILY OPERATIONS ===');
  console.log(`  ${receiveShipment(skus, names, quantities, thresholds, statuses, 'EL-1001', 20)}`);
  console.log(`  ${receiveShipment(skus, names, quantities, thresholds, statuses, 'CL-2001', 50)}`);
  console.log(`  ${fulfillOrder(skus, names, quantities, thresholds, statuses, 'EL-1001', 10)}`);
  console.log(`  ${fulfillOrder(skus, names, quantities, thresholds, statuses, 'MA-5001', 150)}`);
  console.log(`  ${fulfillOrder(skus, names, quantities, thresholds, statuses, 'TL-4002', 5)}`);
  console.log(`  ${receiveShipment(skus, names, quantities, thresholds, statuses, 'CL-2002', 25)}`);

  printInventoryTable(skus, names, categories, quantities, unitCosts, statuses, 'Main Depot');
  printStats(quantities, unitCosts, statuses, categories, 'Main Depot');
  printRestockReport(skus, names, quantities, thresholds, unitCosts, statuses);

  console.log('\n  === TRANSFERS TO SATELLITE ===');
  addEntry(satSkus, satNames, satCategories, satQuantities, satThresholds, satUnitCosts, satLocations, satStatuses,
    'CL-2001', 'Safety Vest', 1, 30, 20, 1250, 'S-01');
  addEntry(satSkus, satNames, satCategories, satQuantities, satThresholds, satUnitCosts, satLocations, satStatuses,
    'EL-1001', 'Multimeter', 0, 15, 10, 2999, 'S-02');
  addEntry(satSkus, satNames, satCategories, satQuantities, satThresholds, satUnitCosts, satLocations, satStatuses,
    'TL-4002', 'Wire Stripper', 3, 5, 8, 1500, 'S-03');

  const mainIdx1 = 2;
  quantities[mainIdx1] = quantities[mainIdx1] - 30;
  const mainIdx2 = 0;
  quantities[mainIdx2] = quantities[mainIdx2] - 15;
  const mainIdx3 = 6;
  quantities[mainIdx3] = quantities[mainIdx3] - 5;

  console.log('  Moved 30 Safety Vests -> Satellite');
  console.log('  Moved 15 Multimeters -> Satellite');
  console.log('  Moved 5 Wire Strippers -> Satellite');

  addEntry(satSkus, satNames, satCategories, satQuantities, satThresholds, satUnitCosts, satLocations, satStatuses,
    'TL-4003', 'Pliers', 3, 40, 10, 1125, 'S-04');
  addEntry(satSkus, satNames, satCategories, satQuantities, satThresholds, satUnitCosts, satLocations, satStatuses,
    'MA-5003', 'Electrical Tape', 4, 250, 50, 150, 'S-05');

  printInventoryTable(satSkus, satNames, satCategories, satQuantities, satUnitCosts, satStatuses, 'Satellite Store');

  console.log('\n  === CONSOLIDATED SUMMARY ===');
  const mainVal = totalValue(quantities, unitCosts);
  const satVal = totalValue(satQuantities, satUnitCosts);
  console.log(`  Main Depot products:     ${skus.length}`);
  console.log(`  Satellite products:      ${satSkus.length}`);
  console.log(`  Main Depot value (cents):${mainVal}`);
  console.log(`  Satellite value (cents): ${satVal}`);
  console.log(`  Combined value (cents):  ${mainVal + satVal}`);

  printLowStock(skus, names, quantities, thresholds, statuses, 'Main Depot');
  printCategory(names, categories, quantities, unitCosts, 0);

  console.log('\n============================================================');
  console.log('  DEMO COMPLETE');
  console.log('============================================================');
}

main();
