// arrays.h — regression fixture for C array declarators in function params
// and typedefs. Mirrors real ESP-IDF idioms like esp_wifi_set_mac(uint8_t mac[6])
// and the parameter-only array form esp_netif_set_mac(uint8_t mac[]).

#include <stdint.h>

// Function parameters with sized array declarators — extremely common in IDF.
// The emitter should normalize: `uint8_t mac[6]` → type="uint8_t", name="mac".
esp_err_t set_mac_sized(int ifx, uint8_t mac[6]);

// Function parameters with unsized array declarators (decays to pointer).
esp_err_t set_mac_unsized(int ifx, uint8_t mac[]);

// Struct field with array declarator (existing case, but worth locking in).
typedef struct { uint8_t bytes[4]; int n; } buf_t;
