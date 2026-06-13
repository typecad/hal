export function randomRange(min: number, max: number): number {
  const diff = max - min;
  return min + Math.floor(Math.random() * diff);
}

export function randomFloat(): number {
  return Math.random();
}