// ---------------------------------------------------------------------------
// Shared lowering utilities
// ---------------------------------------------------------------------------

/** Parse a peripheral bus/port string like "UART0" / "I2C1" / "SPI2" → numeric
 *  index. The HAL op stream carries the bus as a TS-side name (I2C0, SPI0);
 *  the index selects which controller in the chip descriptor is used. */
export function parseControllerIndex(busOrPort: string | undefined): number {
  if (!busOrPort) return 0;
  const m = busOrPort.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}
