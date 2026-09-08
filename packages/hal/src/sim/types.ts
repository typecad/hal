// ---------------------------------------------------------------------------
// @typecad/hal/sim — Simulator-specific types
// ---------------------------------------------------------------------------

/**
 * Callback signature for pin state change events.
 * @param pinNumber - The pin number that changed
 * @param newValue - The new digital value (HIGH=1 or LOW=0)
 */
export type PinChangeCallback = (pinNumber: number, newValue: number) => void;

/**
 * Callback signature for interrupt events.
 * @param pinNumber - The interrupt pin number
 * @param mode - The trigger mode ('rising', 'falling', or 'change')
 */
export type InterruptCallback = (pinNumber: number, mode: 'rising' | 'falling' | 'change') => void;

/**
 * A simulated I2C device that responds to register reads and writes.
 * Tests register mock devices to simulate sensor behavior.
 */
export interface ISimI2CDevice {
  /**
   * Handle a register read from the bus master.
   * @param register - The register address being read
   * @param count - Number of bytes requested
   * @returns Array of byte values to return
   */
  read(register: number, count: number): number[];

  /**
   * Handle a register write from the bus master.
   * @param register - The register address being written
   * @param data - The data bytes being written
   */
  write(register: number, data: number[]): void;
}

/**
 * A simulated SPI device that responds to transfers.
 */
export interface ISimSPIDevice {
  /**
   * Handle a full-duplex SPI transfer.
   * @param mosiData - Data sent from master (MOSI)
   * @returns Data received from device (MISO)
   */
  transfer(mosiData: number[]): number[];

  /**
   * Handle a register write (optional).
   * If not provided, falls back to transfer().
   * @param register - The register address
   * @param data - The data bytes being written
   */
  write?(register: number, data: number[]): void;

  /**
   * Handle a register read (optional).
   * If not provided, falls back to transfer() with dummy bytes.
   * @param register - The register address
   * @param count - Number of bytes to read
   * @returns Data bytes read from the register
   */
  readRegister?(register: number, count: number): number[];
}

/**
 * Configuration for creating a simulated board.
 */
export interface SimBoardConfig {
  /** Number of digital pins (default: 14) */
  digitalPinCount?: number;
  /** Number of analog input pins (default: 6) */
  analogPinCount?: number;
  /** Number of I2C buses (default: 1) */
  i2cBusCount?: number;
  /** Number of SPI buses (default: 1) */
  spiBusCount?: number;
  /** Number of UART ports (default: 1) */
  uartCount?: number;
  /**
   * PWM-capable pin numbers. Defaults to empty (no PWM pins); declare the
   * board's real PWM pins here, or use `createBoardFromDefinition()` to derive
   * them from a board package.
   */
  pwmPins?: number[];
  /**
   * Interrupt-capable pin numbers. Defaults to empty; declare the board's real
   * interrupt pins here, or use `createBoardFromDefinition()`.
   */
  interruptPins?: number[];
  /** RX buffer size for UART simulation (default: 256) */
  uartRxBufferSize?: number;
  /** TX buffer size for UART simulation (default: 256) */
  uartTxBufferSize?: number;
}
