/**
 * Best-effort C++ return type for a HAL expression op.
 * Used by snprintf format inference and expression type inference so
 * string-returning ops (e.g. wifi.scan_ssid → const char*) use %s, not %d.
 */
export function cppTypeForHalOp(operation: string): string | undefined {
  switch (operation) {
    case "wifi.local_ip":
    case "wifi.mac":
    case "wifi.scan_ssid":
    case "http.body":
    case "http.response_header":
      return "const char*";
    case "wifi.is_connected":
    case "wifi.join":
    case "wifi.scan_done":
    case "wifi.ap_start":
    case "http.ok":
    case "http.done":
      return "bool";
    case "wifi.rssi":
    case "wifi.scan":
    case "wifi.scan_count":
    case "wifi.scan_rssi":
    case "wifi.scan_encryption":
    case "wifi.scan_channel":
    case "http.status":
    case "http.content_length":
      return "int";
    case "http.send":
      return "bool";
    // Zephyr's sensor channel value is a double (val1 + val2/1e6).
    case "sensor.get":
      return "double";
    // Settings reads: the shim's typed accessors (int32_t/bool/float/const
    // char*). Typing these lets the enum↔integral storage boundary cast a
    // `let mode: FanMode = store.getInt(...)` initializer into the scoped
    // enum, and the snprintf specifier ladder pick the right format.
    case "preferences.get_int":
      return "int32_t";
    case "preferences.get_bool":
      return "bool";
    case "preferences.get_float":
      return "double";
    case "preferences.get_string":
      return "const char*";
    default:
      return undefined;
  }
}
