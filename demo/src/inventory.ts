import { calcStatus } from './utils';

export function findIndex(
  skus: string[],
  sku: string,
): number {
  let i = 0;
  while (i < skus.length) {
    if (skus[i] === sku) {
      return i;
    }
    i = i + 1;
  }
  return -1;
}

export function addEntry(
  skus: Mutable<string[]>,
  names: Mutable<string[]>,
  categories: Mutable<number[]>,
  quantities: Mutable<number[]>,
  thresholds: Mutable<number[]>,
  unitCosts: Mutable<number[]>,
  locations: Mutable<string[]>,
  statuses: Mutable<number[]>,
  sku: string,
  name: string,
  category: number,
  quantity: number,
  threshold: number,
  unitCost: number,
  location: string,
): void {
  skus.push(sku);
  names.push(name);
  categories.push(category);
  quantities.push(quantity);
  thresholds.push(threshold);
  unitCosts.push(unitCost);
  locations.push(location);
  statuses.push(calcStatus(quantity, threshold));
}

export function receiveShipment(
  skus: string[],
  names: string[],
  quantities: Mutable<number[]>,
  thresholds: number[],
  statuses: Mutable<number[]>,
  sku: string,
  amount: number,
): string {
  const idx = findIndex(skus, sku);
  if (idx < 0) {
    return `SKU ${sku} not found`;
  }
  quantities[idx] = quantities[idx] + amount;
  statuses[idx] = calcStatus(quantities[idx], thresholds[idx]);
  return `Received ${amount} of ${names[idx]}`;
}

export function fulfillOrder(
  skus: string[],
  names: string[],
  quantities: Mutable<number[]>,
  thresholds: number[],
  statuses: Mutable<number[]>,
  sku: string,
  amount: number,
): string {
  const idx = findIndex(skus, sku);
  if (idx < 0) {
    return `SKU ${sku} not found`;
  }
  if (quantities[idx] < amount) {
    return `Insufficient: ${names[idx]} has ${quantities[idx]}, need ${amount}`;
  }
  quantities[idx] = quantities[idx] - amount;
  statuses[idx] = calcStatus(quantities[idx], thresholds[idx]);
  return `Fulfilled ${amount} of ${names[idx]}`;
}

export function totalValue(
  quantities: number[],
  unitCosts: number[],
): number {
  let total = 0;
  let i = 0;
  while (i < quantities.length) {
    total = total + quantities[i] * unitCosts[i];
    i = i + 1;
  }
  return total;
}

export function totalCount(quantities: number[]): number {
  let total = 0;
  let i = 0;
  while (i < quantities.length) {
    total = total + quantities[i];
    i = i + 1;
  }
  return total;
}

export function countAttention(statuses: number[]): number {
  let count = 0;
  let i = 0;
  while (i < statuses.length) {
    if (statuses[i] === 1 || statuses[i] === 2) {
      count = count + 1;
    }
    i = i + 1;
  }
  return count;
}
