// Touch adapter barrel — native ESP32 touch drivers.
// Each adapter emits the touch_init/touch_isTouched/touch_readRaw surface
// consumed by cuttlefish's ui_poll_touch. Selected by Esp32Strategy's
// resolveTouchAdapter based on display.touch.library.

export { esp32Ft6336uTouchAdapter } from "./ft6336u-esp32.js";
export type { TouchAdapterCodegen } from "./ft6336u-esp32.js";
export { esp32Xpt2046TouchAdapter } from "./xpt2046-esp32.js";
export { esp32Stmpe610TouchAdapter } from "./stmpe610-esp32.js";
export { esp32Gt911TouchAdapter } from "./gt911-esp32.js";
export { esp32Cst816sTouchAdapter } from "./cst816s-esp32.js";
