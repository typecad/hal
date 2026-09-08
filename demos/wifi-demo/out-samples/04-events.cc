#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_mac.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_private/esp_task_wdt.h"


#ifndef CUTTLEFISH_STR_BUF_SIZE
#define CUTTLEFISH_STR_BUF_SIZE 64
#endif

// String helpers
struct __tc_str_ptr {
    char buf[CUTTLEFISH_STR_BUF_SIZE];
    __tc_str_ptr(const char* s = "") { strncpy(buf, s, CUTTLEFISH_STR_BUF_SIZE - 1); buf[CUTTLEFISH_STR_BUF_SIZE - 1] = 0; }
    // Copy only up to and NUL: every setter writes a terminator within
    // bounds and all readers stop at NUL, so the tail is never observed.
    // Bounds the work to content length instead of the full buffer.
    __tc_str_ptr(const __tc_str_ptr& o) { memcpy(buf, o.buf, ::strlen(o.buf) + 1); }
    __tc_str_ptr& operator=(const __tc_str_ptr& o) { memcpy(buf, o.buf, ::strlen(o.buf) + 1); return *this; }
    __tc_str_ptr& operator=(const char* s) { strncpy(buf, s, CUTTLEFISH_STR_BUF_SIZE - 1); buf[CUTTLEFISH_STR_BUF_SIZE - 1] = 0; return *this; }
    const char* c_str() const { return buf; }
    size_t size() const { return ::strlen(buf); }
    size_t length() const { return ::strlen(buf); }
    int indexOf(const char* s) const { const char* p = strstr(buf, s); return p ? p - buf : -1; }
    operator const char*() const { return buf; }
    bool operator==(const char* o) const { return strcmp(buf, o) == 0; }
    bool operator!=(const char* o) const { return strcmp(buf, o) != 0; }
    bool operator==(const __tc_str_ptr& o) const { return strcmp(buf, o.buf) == 0; }
    bool operator!=(const __tc_str_ptr& o) const { return strcmp(buf, o.buf) != 0; }
};
inline size_t (strlen)(const __tc_str_ptr& s) { return ::strlen(s.buf); }
// CUTTLEFISH_WIFI_BEGIN
#define __TC_WIFI_MAX_SCAN 16
#define __TC_WIFI_MAX_EVENT_CB 4
typedef void (*__tc_wifi_cb_t)(void);
static struct {
    volatile int status;         // WiFiStatus enum values
    volatile bool got_ip;
    volatile bool scan_done;
    bool inited;
    bool radio_started;       // esp_wifi_start() succeeded (STA and/or AP)
    bool sta_started;
    bool ap_started;
    bool auto_reconnect;
    esp_netif_t* sta_netif;
    esp_netif_t* ap_netif;
    char ip[16];
    char mac[18];
    // Pending AP config (set via WiFi.apChannel()/apHidden()/apMaxClients() before startAP)
    uint8_t ap_channel;
    bool ap_hidden;
    uint8_t ap_max_clients;
    // TX power in IDF quarter-dBm units; -1 = leave IDF default.
    // Stashed so WiFi.txPower() before connect() still applies after esp_wifi_start()
    // (esp_wifi_set_max_tx_power is a no-op / error before the radio is up).
    int8_t tx_power_qdbm;
    uint16_t scan_count;
    wifi_ap_record_t scan_records[__TC_WIFI_MAX_SCAN];
    __tc_wifi_cb_t on_connect;
    __tc_wifi_cb_t on_disconnect;
    __tc_wifi_cb_t on_got_ip;
} __tc_wifi = { 0, false, false, false, false, false, false, true, NULL, NULL, {0}, {0}, 1, false, 4, -1, 0, {}, NULL, NULL, NULL };

static inline void __tc_wifi_apply_tx_power(void) {
    if (__tc_wifi.tx_power_qdbm >= 0) {
        esp_wifi_set_max_tx_power(__tc_wifi.tx_power_qdbm);
    }
}

static void __tc_wifi_event_handler(void* arg, esp_event_base_t base, int32_t id, void* data) {
    (void)arg;
    if (base == WIFI_EVENT) {
        switch (id) {
        case WIFI_EVENT_STA_START:
            __tc_wifi_apply_tx_power();
            break;
        case WIFI_EVENT_STA_CONNECTED:
            if (__tc_wifi.on_connect) __tc_wifi.on_connect();
            break;
        case WIFI_EVENT_STA_DISCONNECTED:
            __tc_wifi.got_ip = false;
            if (__tc_wifi.status == 2) {
                __tc_wifi.status = 4; // Disconnected
                if (__tc_wifi.on_disconnect) __tc_wifi.on_disconnect();
            } else if (__tc_wifi.status == 1) {
                __tc_wifi.status = 3; // ConnectFailed (this attempt)
            }
            if (__tc_wifi.auto_reconnect && __tc_wifi.sta_started) {
                esp_wifi_connect();
                if (__tc_wifi.status != 2) __tc_wifi.status = 1;
            }
            break;
        case WIFI_EVENT_SCAN_DONE:
            __tc_wifi.scan_count = __TC_WIFI_MAX_SCAN;
            esp_wifi_scan_get_ap_records(&__tc_wifi.scan_count, __tc_wifi.scan_records);
            __tc_wifi.scan_done = true;
            break;
        default: break;
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* ev = (ip_event_got_ip_t*)data;
        snprintf(__tc_wifi.ip, sizeof(__tc_wifi.ip), IPSTR, IP2STR(&ev->ip_info.ip));
        __tc_wifi.got_ip = true;
        __tc_wifi.status = 2; // Connected
        if (__tc_wifi.on_got_ip) __tc_wifi.on_got_ip();
    }
}

static void __tc_wifi_ensure_init(void) {
    if (__tc_wifi.inited) return;
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }
    ESP_ERROR_CHECK(esp_netif_init());
    {
        esp_err_t e = esp_event_loop_create_default();
        if (e != ESP_OK && e != ESP_ERR_INVALID_STATE) ESP_ERROR_CHECK(e);
    }
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &__tc_wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &__tc_wifi_event_handler, NULL, NULL));
    __tc_wifi.inited = true;
}

static void __tc_wifi_ensure_sta(void) {
    __tc_wifi_ensure_init();
    if (!__tc_wifi.sta_netif) __tc_wifi.sta_netif = esp_netif_create_default_wifi_sta();
}

static inline bool __tc_wifi_is_connected(void) {
    return __tc_wifi.status == 2 && __tc_wifi.got_ip;
}

static inline void __tc_wifi_start_radio(void) {
    if (__tc_wifi.radio_started) return;
    esp_err_t err = esp_wifi_start();
    // ESP_ERR_WIFI_CONN = already started (e.g. AP path raced us).
    if (err != ESP_OK && err != ESP_ERR_WIFI_CONN) ESP_ERROR_CHECK(err);
    __tc_wifi.radio_started = true;
    __tc_wifi_apply_tx_power();
}

static inline bool __tc_wifi_connect_start(const char* ssid, const char* pass) {
    printf("wifi: init (%s)\n", ssid ? ssid : "");
    fflush(stdout);
    __tc_wifi_ensure_sta();
    wifi_config_t wc = {};
    strlcpy((char*)wc.sta.ssid, ssid, sizeof(wc.sta.ssid));
    strlcpy((char*)wc.sta.password, pass ? pass : "", sizeof(wc.sta.password));
    wc.sta.threshold.authmode = (pass && pass[0]) ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    wifi_mode_t mode = __tc_wifi.ap_started ? WIFI_MODE_APSTA : WIFI_MODE_STA;
    ESP_ERROR_CHECK(esp_wifi_set_mode(mode));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    __tc_wifi.status = 1; // Connecting
    __tc_wifi.got_ip = false;
    if (!__tc_wifi.sta_started) {
        printf("wifi: starting radio\n");
        fflush(stdout);
        __tc_wifi_start_radio();
        __tc_wifi.sta_started = true;
    } else {
        __tc_wifi_apply_tx_power();
    }
    printf("wifi: connecting\n");
    fflush(stdout);
    ESP_ERROR_CHECK(esp_wifi_connect());
    return true;
}

#if CONFIG_ESP_TASK_WDT_EN
static inline void __tc_wifi_pause_wdt(void) {
    esp_task_wdt_stop();
}
static inline void __tc_wifi_resume_wdt(void) {
    esp_task_wdt_restart();
}
#else
static inline void __tc_wifi_pause_wdt(void) {}
static inline void __tc_wifi_resume_wdt(void) {}
#endif

static inline bool __tc_wifi_wait_connected(uint32_t timeout_ms) {
    __tc_wifi_pause_wdt();
    int64_t deadline = esp_timer_get_time() + (int64_t)timeout_ms * 1000;
    while (!__tc_wifi_is_connected()) {
        if (timeout_ms > 0 && esp_timer_get_time() >= deadline) {
            __tc_wifi_resume_wdt();
            return false;
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    __tc_wifi_resume_wdt();
    return true;
}

static inline bool __tc_wifi_connect(const char* ssid, const char* pass, uint32_t timeout_ms) {
    __tc_wifi_connect_start(ssid, pass);
    return __tc_wifi_wait_connected(timeout_ms);
}

static inline void __tc_wifi_wait_disconnected(void) {
    __tc_wifi_pause_wdt();
    while (__tc_wifi_is_connected()) vTaskDelay(pdMS_TO_TICKS(50));
    __tc_wifi_resume_wdt();
}

static inline void __tc_wifi_disconnect(void) {
    bool prev_auto = __tc_wifi.auto_reconnect;
    __tc_wifi.auto_reconnect = false;
    esp_wifi_disconnect();
    __tc_wifi.status = 4;
    __tc_wifi.got_ip = false;
    __tc_wifi.auto_reconnect = prev_auto;
}

static inline const char* __tc_wifi_local_ip(void) {
    return __tc_wifi.got_ip ? __tc_wifi.ip : "0.0.0.0";
}

static inline int __tc_wifi_rssi(void) {
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) return ap.rssi;
    return 0;
}

static inline const char* __tc_wifi_mac(void) {
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(__tc_wifi.mac, sizeof(__tc_wifi.mac), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return __tc_wifi.mac;
}

static inline void __tc_wifi_set_hostname(const char* name) {
    __tc_wifi_ensure_sta();
    esp_netif_set_hostname(__tc_wifi.sta_netif, name);
}

static inline void __tc_wifi_static_ip(const char* ip, const char* gw, const char* mask, const char* dns) {
    __tc_wifi_ensure_sta();
    esp_netif_dhcpc_stop(__tc_wifi.sta_netif);
    esp_netif_ip_info_t info = {};
    info.ip.addr = esp_ip4addr_aton(ip);
    info.gw.addr = esp_ip4addr_aton(gw);
    info.netmask.addr = esp_ip4addr_aton(mask);
    esp_netif_set_ip_info(__tc_wifi.sta_netif, &info);
    if (dns && dns[0]) {
        esp_netif_dns_info_t d = {};
        d.ip.u_addr.ip4.addr = esp_ip4addr_aton(dns);
        d.ip.type = ESP_IPADDR_TYPE_V4;
        esp_netif_set_dns_info(__tc_wifi.sta_netif, ESP_NETIF_DNS_MAIN, &d);
    }
}

static inline void __tc_wifi_set_power_save(const char* mode) {
    esp_wifi_set_ps(strcmp(mode, "none") == 0 ? WIFI_PS_NONE : WIFI_PS_MIN_MODEM);
}

static inline void __tc_wifi_set_tx_power(int dbm) {
    // Clamp to the practical IDF range (~2..20 dBm). Stored in 0.25 dBm units.
    if (dbm < 2) dbm = 2;
    if (dbm > 20) dbm = 20;
    __tc_wifi.tx_power_qdbm = (int8_t)(dbm * 4);
    if (__tc_wifi.sta_started || __tc_wifi.ap_started || __tc_wifi.radio_started) {
        __tc_wifi_apply_tx_power();
    }
}

// ── SoftAP ──
static inline bool __tc_wifi_ap_start(const char* ssid, const char* pass) {
    __tc_wifi_ensure_init();
    if (!__tc_wifi.ap_netif) __tc_wifi.ap_netif = esp_netif_create_default_wifi_ap();
    wifi_config_t wc = {};
    strlcpy((char*)wc.ap.ssid, ssid, sizeof(wc.ap.ssid));
    wc.ap.ssid_len = (uint8_t)strlen(ssid);
    wc.ap.channel = __tc_wifi.ap_channel;
    wc.ap.max_connection = __tc_wifi.ap_max_clients;
    wc.ap.ssid_hidden = __tc_wifi.ap_hidden ? 1 : 0;
    if (pass && pass[0]) {
        strlcpy((char*)wc.ap.password, pass, sizeof(wc.ap.password));
        wc.ap.authmode = WIFI_AUTH_WPA2_PSK;
    } else {
        wc.ap.authmode = WIFI_AUTH_OPEN;
    }
    wifi_mode_t mode = __tc_wifi.sta_started ? WIFI_MODE_APSTA : WIFI_MODE_AP;
    esp_wifi_set_mode(mode);
    esp_wifi_set_config(WIFI_IF_AP, &wc);
    __tc_wifi_start_radio();
    __tc_wifi.ap_started = true;
    return true;
}

static inline void __tc_wifi_ap_stop(void) {
    if (!__tc_wifi.ap_started) return;
    esp_wifi_set_mode(__tc_wifi.sta_started ? WIFI_MODE_STA : WIFI_MODE_NULL);
    __tc_wifi.ap_started = false;
}

static inline int __tc_wifi_ap_client_count(void) {
    wifi_sta_list_t list;
    if (esp_wifi_ap_get_sta_list(&list) == ESP_OK) return list.num;
    return 0;
}

static inline const char* __tc_wifi_ap_ip(void) {
    static char buf[16];
    esp_netif_ip_info_t info;
    if (__tc_wifi.ap_netif && esp_netif_get_ip_info(__tc_wifi.ap_netif, &info) == ESP_OK) {
        snprintf(buf, sizeof(buf), IPSTR, IP2STR(&info.ip));
        return buf;
    }
    return "0.0.0.0";
}

// ── Scan ──
static inline void __tc_wifi_scan_start(void) {
    __tc_wifi_ensure_sta();
    if (!__tc_wifi.sta_started) {
        esp_wifi_set_mode(__tc_wifi.ap_started ? WIFI_MODE_APSTA : WIFI_MODE_STA);
        __tc_wifi_start_radio();
        __tc_wifi.sta_started = true;
    } else {
        __tc_wifi_apply_tx_power();
    }
    __tc_wifi.scan_done = false;
    __tc_wifi.scan_count = 0;
    wifi_scan_config_t sc = {};
    esp_wifi_scan_start(&sc, false);
}

static inline bool __tc_wifi_scan_done(void) { return __tc_wifi.scan_done; }

static inline int __tc_wifi_scan(void) {
    __tc_wifi_scan_start();
    __tc_wifi_pause_wdt();
    while (!__tc_wifi.scan_done) vTaskDelay(pdMS_TO_TICKS(50));
    __tc_wifi_resume_wdt();
    return __tc_wifi.scan_count;
}

static inline int __tc_wifi_scan_count(void) { return __tc_wifi.scan_count; }

static inline const char* __tc_wifi_scan_ssid(int i) {
    if (i < 0 || i >= __tc_wifi.scan_count) return "";
    return (const char*)__tc_wifi.scan_records[i].ssid;
}

static inline int __tc_wifi_scan_rssi(int i) {
    if (i < 0 || i >= __tc_wifi.scan_count) return 0;
    return __tc_wifi.scan_records[i].rssi;
}

static inline int __tc_wifi_scan_channel(int i) {
    if (i < 0 || i >= __tc_wifi.scan_count) return 0;
    return __tc_wifi.scan_records[i].primary;
}

// Map esp authmode → HAL WiFiEncryption (0 Open, 1 WEP, 2 WPA, 3 WPA2, 4 WPA3, 5 Enterprise)
static inline int __tc_wifi_scan_encryption(int i) {
    if (i < 0 || i >= __tc_wifi.scan_count) return 0;
    switch (__tc_wifi.scan_records[i].authmode) {
    case WIFI_AUTH_OPEN: return 0;
    case WIFI_AUTH_WEP: return 1;
    case WIFI_AUTH_WPA_PSK: return 2;
    case WIFI_AUTH_WPA2_PSK: case WIFI_AUTH_WPA_WPA2_PSK: return 3;
    case WIFI_AUTH_WPA3_PSK: case WIFI_AUTH_WPA2_WPA3_PSK: return 4;
    case WIFI_AUTH_WPA2_ENTERPRISE: return 5;
    default: return 3;
    }
}

// ── Saved credentials (NVS namespace "tc_wifi") ──
static inline void __tc_wifi_save_credentials(const char* ssid, const char* pass) {
    __tc_wifi_ensure_init();
    nvs_handle_t h;
    if (nvs_open("tc_wifi", NVS_READWRITE, &h) == ESP_OK) {
        nvs_set_str(h, "ssid", ssid);
        nvs_set_str(h, "pass", pass ? pass : "");
        nvs_commit(h);
        nvs_close(h);
    }
}

static inline bool __tc_wifi_connect_saved(uint32_t timeout_ms) {
    __tc_wifi_ensure_init();
    nvs_handle_t h;
    char ssid[33] = {0}, pass[65] = {0};
    size_t ssid_len = sizeof(ssid), pass_len = sizeof(pass);
    if (nvs_open("tc_wifi", NVS_READONLY, &h) != ESP_OK) return false;
    esp_err_t e1 = nvs_get_str(h, "ssid", ssid, &ssid_len);
    nvs_get_str(h, "pass", pass, &pass_len);
    nvs_close(h);
    if (e1 != ESP_OK || ssid[0] == 0) return false;
    return __tc_wifi_connect(ssid, pass, timeout_ms);
}

static inline void __tc_wifi_clear_credentials(void) {
    __tc_wifi_ensure_init();
    nvs_handle_t h;
    if (nvs_open("tc_wifi", NVS_READWRITE, &h) == ESP_OK) {
        nvs_erase_all(h);
        nvs_commit(h);
        nvs_close(h);
    }
}
// CUTTLEFISH_WIFI_END

// --- ESP32 IDF entrypoint: app_main runs setup()/loop() directly ---
// The typecad-hal synthesizer emits setup() and loop() (it keys off
// entrypointFunctionName()="setup" and requiresLoopFunction()=true).
//
// Following the IDF-idiomatic pattern (see esp_http_client example:
// app_main blocks on example_connect() directly), app_main itself runs
// setup() and the loop() forever. setup() typically blocks on WiFi
// connect — exactly what main_task is designed for. Spawning a separate
// task to host setup/loop was non-idiomatic and caused watchdog resets
// under WiFi load: main_task sat idle while our prio-1 spawned task
// competed with the prio-23 WiFi task for CPU0.
//
// Stack: CONFIG_ESP_MAIN_TASK_STACK_SIZE=16384 (set in sdkconfig.defaults)
// — the IDF default of 3584 overflows on WiFi/HTTP paths (esp_wifi_connect,
// TLS handshake, printf with response bodies).
extern void setup(void);
extern void loop(void);

extern "C" void app_main(void) {
    setup();
    for (;;) {
        loop();
        // Yield to the IDLE task so the task watchdog does not fire when
        // loop() is empty or runs without blocking. Costs ~1 ms/iteration.
        vTaskDelay(1);
    }
}


// 04 — event-callback style: no async functions, no blocking connect.
const __tc_str_ptr WIFI_SSID = "HomeNet";
const __tc_str_ptr WIFI_PASSWORD = "hunter22";

IRAM_ATTR void main_isr_0();
IRAM_ATTR void main_isr_1();

IRAM_ATTR void main_isr_0() {
  printf("online\n");
}

IRAM_ATTR void main_isr_1() {
  printf("link lost, auto-reconnecting\n");
}

// Auto-generated setup() for top-level statements
void setup()
{
  __tc_wifi.on_got_ip = &main_isr_0;
  __tc_wifi.on_disconnect = &main_isr_1;
  __tc_wifi_connect_start(WIFI_SSID, WIFI_PASSWORD);
  while (true)
  {
    if (__tc_wifi_is_connected())
    {
    }
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

void loop()
{
}
