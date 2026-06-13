import { StockEntry, WarehouseStats, RestockOrder, ProductCategory, StockStatus } from './types';
import { needsReorder, reorderQuantity, addStock, removeStock, totalValue } from './product';

export interface Warehouse {
  name: string;
  products: StockEntry[];
}

export function createWarehouse(name: string): Warehouse {
  const wh: Warehouse = {
    name: name,
    products: [],
  };
  return wh;
}

export function findBySku(wh: Warehouse, sku: string): StockEntry {
  let i = 0;
  while (i < wh.products.length) {
    if (wh.products[i].sku === sku) {
      return wh.products[i];
    }
    i = i + 1;
  }
  return wh.products[0];
}

export function hasSku(wh: Warehouse, sku: string): boolean {
  let i = 0;
  while (i < wh.products.length) {
    if (wh.products[i].sku === sku) {
      return true;
    }
    i = i + 1;
  }
  return false;
}

export function receiveShipment(wh: Warehouse, sku: string, amount: number): string {
  if (!hasSku(wh, sku)) {
    return `SKU ${sku} not found`;
  }
  const product = findBySku(wh, sku);
  addStock(product, amount);
  return `Received ${amount} units of ${product.name}`;
}

export function fulfillOrder(wh: Warehouse, sku: string, amount: number): string {
  if (!hasSku(wh, sku)) {
    return `SKU ${sku} not found`;
  }
  const product = findBySku(wh, sku);
  if (product.quantity < amount) {
    return `Insufficient stock: ${product.name} has ${product.quantity}, requested ${amount}`;
  }
  const taken = removeStock(product, amount);
  return `Fulfilled ${taken} units of ${product.name}`;
}

export function getLowStock(wh: Warehouse): StockEntry[] {
  const result: StockEntry[] = [];
  let i = 0;
  while (i < wh.products.length) {
    if (needsReorder(wh.products[i])) {
      result.push(wh.products[i]);
    }
    i = i + 1;
  }
  return result;
}

export function getByCategory(wh: Warehouse, category: ProductCategory): StockEntry[] {
  const result: StockEntry[] = [];
  let i = 0;
  while (i < wh.products.length) {
    if (wh.products[i].category === category) {
      result.push(wh.products[i]);
    }
    i = i + 1;
  }
  return result;
}

export function totalInventoryValue(wh: Warehouse): number {
  let total = 0;
  let i = 0;
  while (i < wh.products.length) {
    total = total + totalValue(wh.products[i]);
    i = i + 1;
  }
  return total;
}

export function totalItemCount(wh: Warehouse): number {
  let total = 0;
  let i = 0;
  while (i < wh.products.length) {
    total = total + wh.products[i].quantity;
    i = i + 1;
  }
  return total;
}

export function computeStats(wh: Warehouse): WarehouseStats {
  let lowCount = 0;
  let outCount = 0;
  const catCounts: number[] = [0, 0, 0, 0, 0];

  let i = 0;
  while (i < wh.products.length) {
    const p = wh.products[i];
    if (p.status === StockStatus.LowStock) {
      lowCount = lowCount + 1;
    }
    if (p.status === StockStatus.OutOfStock) {
      outCount = outCount + 1;
    }
    const catIndex = p.category;
    if (catIndex >= 0 && catIndex < 5) {
      catCounts[catIndex] = catCounts[catIndex] + 1;
    }
    i = i + 1;
  }

  const stats: WarehouseStats = {
    totalItems: totalItemCount(wh),
    totalValue: totalInventoryValue(wh),
    lowStockCount: lowCount,
    outOfStockCount: outCount,
    categoryCounts: catCounts,
  };
  return stats;
}

export function generateRestockOrders(wh: Warehouse): RestockOrder[] {
  const orders: RestockOrder[] = [];
  let i = 0;
  while (i < wh.products.length) {
    const p = wh.products[i];
    if (needsReorder(p)) {
      const qty = reorderQuantity(p);
      const order: RestockOrder = {
        sku: p.sku,
        name: p.name,
        quantity: qty,
        estimatedCost: qty * p.unitCost,
      };
      orders.push(order);
    }
    i = i + 1;
  }
  return orders;
}

export function transferTo(
  source: Warehouse,
  dest: Warehouse,
  sku: string,
  amount: number,
): string {
  if (!hasSku(source, sku)) {
    return `SKU ${sku} not found in ${source.name}`;
  }
  const srcProduct = findBySku(source, sku);
  if (srcProduct.quantity < amount) {
    return `Not enough ${srcProduct.name} in ${source.name} to transfer`;
  }
  removeStock(srcProduct, amount);

  if (hasSku(dest, sku)) {
    const dstProduct = findBySku(dest, sku);
    addStock(dstProduct, amount);
  } else {
    const clone: StockEntry = {
      sku: srcProduct.sku,
      name: srcProduct.name,
      category: srcProduct.category,
      quantity: amount,
      reorderThreshold: srcProduct.reorderThreshold,
      unitCost: srcProduct.unitCost,
      location: srcProduct.location,
      status: StockStatus.InStock,
    };
    refreshStatusInWarehouse(clone);
    dest.products.push(clone);
  }

  return `Transferred ${amount} units of ${srcProduct.name} from ${source.name} to ${dest.name}`;
}

function refreshStatusInWarehouse(entry: StockEntry): void {
  if (entry.quantity <= 0) {
    entry.status = StockStatus.OutOfStock;
  } else if (entry.quantity <= entry.reorderThreshold) {
    entry.status = StockStatus.LowStock;
  } else {
    entry.status = StockStatus.InStock;
  }
}
