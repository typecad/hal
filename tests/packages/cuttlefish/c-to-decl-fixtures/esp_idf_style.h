// esp_idf_style.h — mirrors the idioms of real ESP-IDF wifi/netif/event headers.
// Used by c-to-decl.test.ts to verify the emitter produces free functions
// whose names match the C header verbatim (1-to-1 with how ESP-IDF examples
// call them). No namespace grouping, no renamed methods.

#include <stdint.h>
#include <stdbool.h>

// Plain alias — the canonical "int return code" idiom.
typedef int esp_err_t;

// Opaque handle — the canonical netif/driver idiom.
typedef struct esp_netif_obj *esp_netif_t;

// Anonymous-enum-with-typedef — the canonical "interface selector" idiom.
typedef enum { WIFI_IF_STA = 0, WIFI_IF_AP = 1 } wifi_interface_t;

// Named enum — the canonical "wifi mode" idiom. Constants like WIFI_MODE_STA
// are referenced directly by ESP-IDF user code; they must be exported as
// standalone `export const` declarations.
typedef enum { WIFI_MODE_NULL = 0, WIFI_MODE_STA = 1, WIFI_MODE_AP = 2 } wifi_mode_t;

// Struct typedef — the canonical "config" idiom. ESP-IDF user code declares
// one on the stack and passes &config to the init function.
typedef struct {
    int ssid_addr[6];
    wifi_mode_t mode;
} wifi_config_t;

// Free functions — exactly as an ESP-IDF example calls them.
esp_err_t nvs_flash_init(void);
esp_err_t esp_netif_init(void);
esp_err_t esp_event_loop_create_default(void);
esp_netif_t esp_netif_create_default_wifi_sta(void);
esp_err_t esp_wifi_init(const wifi_config_t *config);
esp_err_t esp_wifi_set_mode(wifi_mode_t mode);
esp_err_t esp_wifi_set_config(wifi_interface_t interface, wifi_config_t *conf);
esp_err_t esp_wifi_start(void);
esp_err_t esp_wifi_connect(void);
esp_err_t esp_netif_get_ip_info(esp_netif_t esp_netif, wifi_config_t *ip_info);

// Function pointer typedef — event handlers use this shape. ESP-IDF emits
// these as `any` with a diagnostic; the demo polls instead. But the typedef
// itself should still produce a declaration.
typedef void (*esp_event_handler_t)(void *arg, void *event_data);
