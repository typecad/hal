/**
 * Shared error handling policy for bus peripherals (I2C, SPI, UART).
 *
 * - 'throw': Assert-style — throws on error (good for development)
 * - 'callback': Calls registered onError handlers
 * - 'silent': Returns status codes only (good for production)
 */
export type ErrorPolicy = 'throw' | 'callback' | 'silent';
