export function formatCurrency(cents: number): string {
  const dollars = cents / 100;
  const remainder = cents % 100;
  if (remainder < 10) {
    return `$${dollars}.0${remainder}`;
  }
  return `$${dollars}.${remainder}`;
}

export function padRight(text: string, width: number): string {
  let result = text;
  let remaining = width - text.length;
  while (remaining > 0) {
    result = `${result} `;
    remaining = remaining - 1;
  }
  return result;
}

export function padLeft(text: string, width: number): string {
  let result = text;
  let remaining = width - text.length;
  while (remaining > 0) {
    result = ` ${result}`;
    remaining = remaining - 1;
  }
  return result;
}

export function statusLabel(status: number): string {
  if (status === 0) {
    return 'In Stock';
  }
  if (status === 1) {
    return 'Low';
  }
  if (status === 2) {
    return 'Out';
  }
  return 'Disc.';
}

export function categoryLabel(category: number): string {
  if (category === 0) {
    return 'Electronics';
  }
  if (category === 1) {
    return 'Clothing';
  }
  if (category === 2) {
    return 'Food';
  }
  if (category === 3) {
    return 'Tools';
  }
  return 'Materials';
}

export function calcStatus(quantity: number, threshold: number): number {
  if (quantity <= 0) {
    return 2;
  }
  if (quantity <= threshold) {
    return 1;
  }
  return 0;
}
