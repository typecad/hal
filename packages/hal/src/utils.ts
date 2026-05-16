/**
 * Helper to inflate peripheral instances from a definition list into a sparse array
 * for named destructuring.
 * 
 * @example
 * export const [UART0, UART1] = createHALInstances(UART_INSTANCES, i => new SerialPort(serialName(i)));
 */
export function createHALInstances<T>(
  instances: readonly { instance: number }[],
  factory: (instance: number) => T
): T[] {
  const result: T[] = [];
  for (const item of instances) {
    result[item.instance] = factory(item.instance);
  }
  return result;
}
