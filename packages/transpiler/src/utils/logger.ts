export function debug(message: string, enabled = false): void {
  if (enabled) {
    console.log(message);
  }
}

export function info(message: string): void {
  console.log(message);
}
