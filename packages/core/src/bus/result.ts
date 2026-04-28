// ---------------------------------------------------------------------------
// @typehal/core — Shared operation result types
//
// Simplified: bus operations return raw values directly. Error handling
// is done via bus-level onError() callbacks rather than per-operation
// result objects.
// ---------------------------------------------------------------------------

// Result types have been removed in favor of direct return values.
// Error handling is done via bus-level onError() callbacks.
//
// I2C: I2C0.onError((status, address, operation) => { ... })
// SPI: SPI0.onError((status) => { ... })
// UART: UART0.onError((status, context) => { ... })
