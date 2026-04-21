export function debug(message: string, enabled = false): void {
  if (enabled) {
    console.log(message);
  }
}

export function info(message: string): void {
  console.log(message);
}

export function warn(message: string): void {
  console.warn(message);
}

export function error(message: string): void {
  console.error(message);
}
