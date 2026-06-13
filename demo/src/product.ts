import {
  ProductCategory,
  StockStatus,
  StockEntry,
} from './types';

export function refreshStatus(entry: StockEntry): void {
  if (entry.quantity <= 0) {
    entry.status = StockStatus.OutOfStock;
  } else if (entry.quantity <= entry.reorderThreshold) {
    entry.status = StockStatus.LowStock;
  } else {
    entry.status = StockStatus.InStock;
  }
}

export function createProduct(
  sku: string,
  name: string,
  category: ProductCategory,
  quantity: number,
  reorderThreshold: number,
  unitCost: number,
  location: string,
): StockEntry {
  const entry: StockEntry = {
    sku: sku,
    name: name,
    category: category,
    quantity: quantity,
    reorderThreshold: reorderThreshold,
    unitCost: unitCost,
    location: location,
    status: StockStatus.InStock,
  };
  refreshStatus(entry);
  return entry;
}

export function addStock(entry: StockEntry, amount: number): void {
  entry.quantity = entry.quantity + amount;
  refreshStatus(entry);
}

export function removeStock(entry: StockEntry, amount: number): number {
  if (amount > entry.quantity) {
    const taken = entry.quantity;
    entry.quantity = 0;
    refreshStatus(entry);
    return taken;
  }
  entry.quantity = entry.quantity - amount;
  refreshStatus(entry);
  return amount;
}

export function totalValue(entry: StockEntry): number {
  return entry.quantity * entry.unitCost;
}

export function needsReorder(entry: StockEntry): boolean {
  return entry.status === StockStatus.LowStock || entry.status === StockStatus.OutOfStock;
}

export function reorderQuantity(entry: StockEntry): number {
  if (!needsReorder(entry)) {
    return 0;
  }
  return entry.reorderThreshold * 2 - entry.quantity;
}
