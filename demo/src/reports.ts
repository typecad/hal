import { totalValue, totalCount, countAttention } from './inventory';
import { formatCurrency, padRight, padLeft, statusLabel, categoryLabel } from './utils';

export function printSeparator(): void {
  console.log('------------------------------------------------------------');
}

export function printHeader(): void {
  console.log('============================================================');
  console.log('  INVENTORY TRACKING SYSTEM');
  console.log('  Cuttlefish Transpiler Demo');
  console.log('============================================================');
}

export function printInventoryTable(
  skus: string[],
  names: string[],
  categories: number[],
  quantities: number[],
  unitCosts: number[],
  statuses: number[],
  title: string,
): void {
  console.log(`\n  INVENTORY REPORT: ${title}`);
  printSeparator();
  console.log(
    padRight('SKU', 10),
    padRight('Name', 18),
    padRight('Category', 12),
    padLeft('Qty', 6),
    padLeft('Cost', 10),
    padLeft('Value', 12),
    padLeft('Status', 10),
  );
  printSeparator();

  let i = 0;
  while (i < skus.length) {
    const val = quantities[i] * unitCosts[i];
    console.log(
      padRight(skus[i], 10),
      padRight(names[i], 18),
      padRight(categoryLabel(categories[i]), 12),
      padLeft(`${quantities[i]}`, 6),
      padLeft(formatCurrency(unitCosts[i]), 10),
      padLeft(formatCurrency(val), 12),
      padLeft(statusLabel(statuses[i]), 10),
    );
    i = i + 1;
  }

  printSeparator();
  console.log(
    padRight('TOTALS', 28),
    padLeft(`${totalCount(quantities)}`, 6),
    padLeft('', 10),
    padLeft(formatCurrency(totalValue(quantities, unitCosts)), 12),
  );
  console.log('');
}

export function printStats(
  quantities: number[],
  unitCosts: number[],
  statuses: number[],
  categories: number[],
  title: string,
): void {
  console.log(`\n  WAREHOUSE STATISTICS: ${title}`);
  printSeparator();
  console.log(`  Total Items:       ${totalCount(quantities)}`);
  console.log(`  Total Value:       ${formatCurrency(totalValue(quantities, unitCosts))}`);
  console.log(`  Attention Needed:  ${countAttention(statuses)} products`);

  const catNames: string[] = ['Electronics', 'Clothing', 'Food', 'Tools', 'Materials'];
  const catCounts: number[] = [0, 0, 0, 0, 0];
  let i = 0;
  while (i < categories.length) {
    const cat = categories[i];
    if (cat >= 0 && cat < 5) {
      catCounts[cat] = catCounts[cat] + 1;
    }
    i = i + 1;
  }

  console.log('\n  By Category:');
  let c = 0;
  while (c < 5) {
    console.log(`    ${padRight(catNames[c], 14)} ${catCounts[c]} products`);
    c = c + 1;
  }
  printSeparator();
}

export function printRestockReport(
  skus: string[],
  names: string[],
  quantities: number[],
  thresholds: number[],
  unitCosts: number[],
  statuses: number[],
): void {
  console.log('\n  RESTOCK ORDERS');
  printSeparator();

  let totalCost = 0;
  let orderCount = 0;
  let i = 0;
  while (i < statuses.length) {
    const status = statuses[i];
    if (status === 1 || status === 2) {
      const qty = thresholds[i] * 2 - quantities[i];
      const cost = qty * unitCosts[i];
      console.log(`  ${skus[i]}  ${names[i]}  x${qty}  ${formatCurrency(cost)}`);
      totalCost = totalCost + cost;
      orderCount = orderCount + 1;
    }
    i = i + 1;
  }

  if (orderCount === 0) {
    console.log('  No restock orders needed.');
  } else {
    printSeparator();
    console.log(`  TOTAL: ${orderCount} orders, cost ${formatCurrency(totalCost)}`);
  }
}

export function printLowStock(
  skus: string[],
  names: string[],
  quantities: number[],
  thresholds: number[],
  statuses: number[],
  title: string,
): void {
  console.log(`\n  LOW/OUT-OF-STOCK: ${title}`);
  let found = 0;
  let i = 0;
  while (i < statuses.length) {
    if (statuses[i] !== 0) {
      console.log(`    ${names[i]} (${skus[i]}): ${quantities[i]} units [threshold: ${thresholds[i]}]`);
      found = found + 1;
    }
    i = i + 1;
  }
  if (found === 0) {
    console.log('    All products are adequately stocked.');
  }
}

export function printCategory(
  names: string[],
  categories: number[],
  quantities: number[],
  unitCosts: number[],
  category: number,
): void {
  const catLabel = categoryLabel(category);
  console.log(`\n  ${catLabel} Products:`);
  let count = 0;
  let i = 0;
  while (i < categories.length) {
    if (categories[i] === category) {
      const val = quantities[i] * unitCosts[i];
      console.log(`    ${names[i]}: ${quantities[i]} units, value ${formatCurrency(val)}`);
      count = count + 1;
    }
    i = i + 1;
  }
  console.log(`  Total: ${count} products`);
}
