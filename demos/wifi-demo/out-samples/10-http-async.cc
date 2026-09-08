#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_mac.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_private/esp_task_wdt.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include <stdlib.h>
#include <iostream>
#include <functional>
#include <vector>
#include <utility>
#include <string>

// Arduino-compat symbols for the shared async_runtime polyfill (ESP-IDF).
#ifndef HIGH
#define HIGH 1
#endif
#ifndef LOW
#define LOW 0
#endif
#ifndef RISING
#define RISING 0x01
#endif
#ifndef FALLING
#define FALLING 0x02
#endif
static inline unsigned long millis() {
    return (unsigned long)(esp_timer_get_time() / 1000);
}
static inline int digitalRead(int pin) {
    return (int)gpio_get_level((gpio_num_t)pin);
}

// Cooperative microtask queue + minimal Promise runtime
namespace typecad_async {
  using Microtask = std::function<void()>;

  class MicrotaskQueue {
  public:
    static MicrotaskQueue& instance() {
      static MicrotaskQueue queue;
      return queue;
    }

    bool enqueue(Microtask task) {
      if (_queue.size() >= 256) {
        return false;
      }
      _queue.push_back(std::move(task));
      return true;
    }

    void pump() {
      const size_t total = _queue.size();
      for (size_t i = 0; i < total; ++i) {
        Microtask task = std::move(_queue[i]);
        task();
      }
      if (total > 0) {
        _queue.erase(_queue.begin(), _queue.begin() + static_cast<long long>(total));
      }
    }

  private:
    std::vector<Microtask> _queue;
  };

  inline void enqueueMicrotask(Microtask task) {
    MicrotaskQueue::instance().enqueue(std::move(task));
  }

  inline void pumpMicrotasks() {
    MicrotaskQueue::instance().pump();
  }

  template <typename T>
  class Promise {
  public:
    enum class State { Pending, Fulfilled, Rejected };

    Promise() : _state(State::Pending), _value{}, _error{} {}

    explicit Promise(std::function<void(std::function<void(const T&)>, std::function<void(const std::string&)>)> executor)
      : _state(State::Pending), _value{}, _error{} {
      executor(
        [this](const T& value) { this->resolve(value); },
        [this](const std::string& error) { this->reject(error); }
      );
    }

    static Promise<T> resolveValue(const T& value) {
      Promise<T> promise;
      promise.resolve(value);
      return promise;
    }

    static Promise<T> rejectValue(const std::string& error) {
      Promise<T> promise;
      promise.reject(error);
      return promise;
    }

    void resolve(const T& value) {
      if (_state != State::Pending) return;
      _state = State::Fulfilled;
      _value = value;
      auto callbacks = _onFulfilled;
      enqueueMicrotask([callbacks, value]() mutable {
        for (auto& callback : callbacks) { callback(value); }
      });
    }

    void reject(const std::string& error) {
      if (_state != State::Pending) return;
      _state = State::Rejected;
      _error = error;
      auto callbacks = _onRejected;
      enqueueMicrotask([callbacks, error]() mutable {
        for (auto& callback : callbacks) { callback(error); }
      });
    }

    Promise<T>& then(std::function<void(const T&)> onFulfilled) {
      if (_state == State::Fulfilled) {
        const T value = _value;
        enqueueMicrotask([onFulfilled, value]() mutable { onFulfilled(value); });
      } else if (_state == State::Pending) {
        _onFulfilled.push_back(std::move(onFulfilled));
      }
      return *this;
    }

    Promise<T>& catchError(std::function<void(const std::string&)> onRejected) {
      if (_state == State::Rejected) {
        const std::string error = _error;
        enqueueMicrotask([onRejected, error]() mutable { onRejected(error); });
      } else if (_state == State::Pending) {
        _onRejected.push_back(std::move(onRejected));
      }
      return *this;
    }

  private:
    State _state;
    T _value;
    std::string _error;
    std::vector<std::function<void(const T&)>> _onFulfilled;
    std::vector<std::function<void(const std::string&)>> _onRejected;
  };

  // Promise<void> — T=_value/const T& is illegal for void. Helpers below pass
  // resolve as std::function<void(const void*)> (pointer, not reference).
  template <>
  class Promise<void> {
  public:
    enum class State { Pending, Fulfilled, Rejected };

    using ResolveFn = std::function<void(const void*)>;
    using RejectFn = std::function<void(const std::string&)>;
    using Executor = std::function<void(ResolveFn, RejectFn)>;

    Promise() : _state(State::Pending), _error{} {}

    explicit Promise(Executor executor)
      : _state(State::Pending), _error{} {
      executor(
        [this](const void*) { this->resolve(nullptr); },
        [this](const std::string& error) { this->reject(error); }
      );
    }

    static Promise<void> resolveValue() {
      Promise<void> promise;
      promise.resolve(nullptr);
      return promise;
    }

    static Promise<void> rejectValue(const std::string& error) {
      Promise<void> promise;
      promise.reject(error);
      return promise;
    }

    void resolve(const void* = nullptr) {
      if (_state != State::Pending) return;
      _state = State::Fulfilled;
      auto callbacks = _onFulfilled;
      enqueueMicrotask([callbacks]() mutable {
        for (auto& callback : callbacks) { callback(nullptr); }
      });
    }

    void reject(const std::string& error) {
      if (_state != State::Pending) return;
      _state = State::Rejected;
      _error = error;
      auto callbacks = _onRejected;
      enqueueMicrotask([callbacks, error]() mutable {
        for (auto& callback : callbacks) { callback(error); }
      });
    }

    Promise<void>& then(std::function<void(const void*)> onFulfilled) {
      if (_state == State::Fulfilled) {
        enqueueMicrotask([onFulfilled]() mutable { onFulfilled(nullptr); });
      } else if (_state == State::Pending) {
        _onFulfilled.push_back(std::move(onFulfilled));
      }
      return *this;
    }

    Promise<void>& catchError(std::function<void(const std::string&)> onRejected) {
      if (_state == State::Rejected) {
        const std::string error = _error;
        enqueueMicrotask([onRejected, error]() mutable { onRejected(error); });
      } else if (_state == State::Pending) {
        _onRejected.push_back(std::move(onRejected));
      }
      return *this;
    }

  private:
    State _state;
    std::string _error;
    std::vector<std::function<void(const void*)>> _onFulfilled;
    std::vector<std::function<void(const std::string&)>> _onRejected;
  };

  // ── HAL-level implementations (inside namespace so they see Promise<T> and enqueueMicrotask) ──

  // Async.sleep() — cooperative delay using millis polling
  inline Promise<void> __cuttlefish_async_sleep(unsigned long ms) {
    return Promise<void>([ms](std::function<void(const void*)> resolve, std::function<void(const std::string&)> reject) {
      unsigned long start = millis();
      if (millis() - start >= ms) {
        resolve(nullptr);
      } else {
        enqueueMicrotask([ms, start, resolve]() {
          if (millis() - start >= ms) {
            resolve(nullptr);
          } else {
            enqueueMicrotask([ms, start, resolve]() { /* will be re-checked next cycle */ });
          }
        });
      }
    });
  }

  // Async.yield() — defer to next microtask pump cycle
  inline Promise<void> __cuttlefish_async_yield() {
    return Promise<void>([](std::function<void(const void*)> resolve, std::function<void(const std::string&)> reject) {
      enqueueMicrotask([resolve]() { resolve(nullptr); });
    });
  }

  // Async.sleepUntil() — poll condition every interval ms
  inline Promise<void> __cuttlefish_async_sleep_until(unsigned long pollIntervalMs) {
    return Promise<void>([pollIntervalMs](std::function<void(const void*)> resolve, std::function<void(const std::string&)> reject) {
      unsigned long start = millis();
      enqueueMicrotask([pollIntervalMs, start, resolve]() {
        if (millis() - start >= pollIntervalMs) {
          resolve(nullptr);  // caller re-checks condition
        } else {
          enqueueMicrotask([pollIntervalMs, start, resolve]() { /* re-check next cycle */ });
        }
      });
    });
  }

  // Async.currentTask() — return task description string
  inline const char* __cuttlefish_async_current_task() {
    return "main";
  }


  // HAL-level wait for pin edge — polling-based implementation.
  // Detects an actual transition (idle→target), not just the current level.
  // Uses a two-phase approach: phase 1 waits for the idle level, phase 2 waits
  // for the target level (the edge). Each phase re-enqueues on the microtask
  // queue so other tasks can run between polls.
  inline Promise<void> __cuttlefish_wait_pin_edge(int pin, int mode, long timeout) {
    return Promise<void>([pin, mode, timeout](std::function<void(const void*)> resolve, std::function<void(const std::string&)> reject) {
      int targetState = (mode == RISING) ? HIGH : LOW;
      int idleState = (mode == RISING) ? LOW : HIGH;
      unsigned long start = millis();
      // Phase 2 poller: waits for the pin to reach the target state (the edge).
      auto pollTarget = [pin, targetState, timeout, start, resolve]() {
        if (digitalRead(pin) == targetState) {
          resolve(nullptr);
        } else if (timeout >= 0 && (millis() - start >= (unsigned long)timeout)) {
          resolve(nullptr);
        } else {
          enqueueMicrotask([pin, targetState, timeout, start, resolve]() {
            if (digitalRead(pin) == targetState) {
              resolve(nullptr);
            } else if (timeout >= 0 && (millis() - start >= (unsigned long)timeout)) {
              resolve(nullptr);
            } else {
              enqueueMicrotask([pin, targetState, timeout, start, resolve]() {});
            }
          });
        }
      };
      // Phase 1: wait for idle state before watching for the edge.
      enqueueMicrotask([pin, idleState, timeout, start, resolve, pollTarget]() {
        if (digitalRead(pin) == idleState) {
          pollTarget();
        } else if (timeout >= 0 && (millis() - start >= (unsigned long)timeout)) {
          resolve(nullptr);
        } else {
          enqueueMicrotask([pin, idleState, timeout, start, resolve, pollTarget]() {});
        }
      });
    });
  }

} // namespace typecad_async

// ── Global-scope aliases so HAL emit() calls resolve ──
using typecad_async::__cuttlefish_async_sleep;
using typecad_async::__cuttlefish_async_yield;
using typecad_async::__cuttlefish_async_sleep_until;
using typecad_async::__cuttlefish_async_current_task;
using typecad_async::__cuttlefish_wait_pin_edge;

inline void cuttlefish_pump_microtasks() {
  typecad_async::pumpMicrotasks();
}


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

// CUTTLEFISH_HTTP_BEGIN
#define __TC_HTTP_DEFAULT_MAX_BODY 8192
#define __TC_HTTP_MAX_HEADERS 8
static struct {
    esp_http_client_handle_t client;
    char url[512];
    esp_http_client_method_t method;
    int timeout_ms;
    size_t max_body;
    const char* body;        // request body (user-owned)
    int body_len;
    bool insecure;
    const char* ca_cert;     // PEM, user-owned; NULL = cert bundle
    const char* hdr_name[__TC_HTTP_MAX_HEADERS];
    const char* hdr_value[__TC_HTTP_MAX_HEADERS];
    int hdr_count;
    // response
    volatile int status;
    volatile bool done;
    volatile bool ok;
    char* resp;
    size_t resp_len;
    int64_t content_length;
    char resp_header[128];
} __tc_http = { NULL, {0}, HTTP_METHOD_GET, 15000, __TC_HTTP_DEFAULT_MAX_BODY, NULL, 0, false, NULL, {0}, {0}, 0, 0, false, false, NULL, 0, -1, {0} };

static esp_err_t __tc_http_event_cb(esp_http_client_event_t* evt) {
    switch (evt->event_id) {
    case HTTP_EVENT_ON_DATA:
        if (__tc_http.resp && evt->data_len > 0) {
            size_t room = __tc_http.max_body - __tc_http.resp_len;
            size_t n = (size_t)evt->data_len < room ? (size_t)evt->data_len : room;
            memcpy(__tc_http.resp + __tc_http.resp_len, evt->data, n);
            __tc_http.resp_len += n;
        }
        break;
    default: break;
    }
    return ESP_OK;
}

/** Clear request options + response; called when Http.get/post/… starts a new request. */
static inline void __tc_http_reset(void) {
    if (__tc_http.client) {
        esp_http_client_cleanup(__tc_http.client);
        __tc_http.client = NULL;
    }
    __tc_http.timeout_ms = 15000;
    __tc_http.max_body = __TC_HTTP_DEFAULT_MAX_BODY;
    __tc_http.body = NULL;
    __tc_http.body_len = 0;
    __tc_http.insecure = false;
    __tc_http.ca_cert = NULL;
    __tc_http.hdr_count = 0;
    __tc_http.status = 0;
    __tc_http.done = false;
    __tc_http.ok = false;
    __tc_http.resp_len = 0;
    __tc_http.content_length = -1;
    __tc_http.resp_header[0] = 0;
}

static inline void __tc_http_apply_headers(void) {
    if (!__tc_http.client) return;
    for (int i = 0; i < __tc_http.hdr_count; i++) {
        esp_http_client_set_header(__tc_http.client, __tc_http.hdr_name[i], __tc_http.hdr_value[i]);
    }
}

static inline void __tc_http_begin(esp_http_client_method_t method, const char* url) {
    if (__tc_http.client) {
        esp_http_client_cleanup(__tc_http.client);
        __tc_http.client = NULL;
    }
    strlcpy(__tc_http.url, url, sizeof(__tc_http.url));
    __tc_http.method = method;
    // Keep timeout/max_body/body/tls/headers already set by setters before send().
    __tc_http.status = 0;
    __tc_http.done = false;
    __tc_http.ok = false;
    __tc_http.resp_len = 0;
    __tc_http.content_length = -1;
    __tc_http.resp_header[0] = 0;

    esp_http_client_config_t cfg = {};
    cfg.url = __tc_http.url;
    cfg.method = method;
    cfg.timeout_ms = __tc_http.timeout_ms;
    cfg.event_handler = &__tc_http_event_cb;
    if (__tc_http.insecure) {
        cfg.skip_cert_common_name_check = true;
    } else if (__tc_http.ca_cert) {
        cfg.cert_pem = __tc_http.ca_cert;
    } else {
        cfg.crt_bundle_attach = esp_crt_bundle_attach;
    }
    __tc_http.client = esp_http_client_init(&cfg);
    __tc_http_apply_headers();
}

static inline void __tc_http_set_header(const char* name, const char* value) {
    if (__tc_http.hdr_count < __TC_HTTP_MAX_HEADERS) {
        __tc_http.hdr_name[__tc_http.hdr_count] = name;
        __tc_http.hdr_value[__tc_http.hdr_count] = value;
        __tc_http.hdr_count++;
    }
    if (__tc_http.client) esp_http_client_set_header(__tc_http.client, name, value);
}

static inline void __tc_http_set_timeout(int ms) {
    __tc_http.timeout_ms = ms;
    if (__tc_http.client) esp_http_client_set_timeout_ms(__tc_http.client, ms);
}

static inline void __tc_http_set_max_body(size_t bytes) { __tc_http.max_body = bytes; }

static inline void __tc_http_set_body(const char* data, bool json) {
    __tc_http.body = data;
    __tc_http.body_len = (int)strlen(data);
    if (json) __tc_http_set_header("Content-Type", "application/json");
}

// insecure()/caCert() need a client re-init: TLS config is set at init time.
static inline void __tc_http_reinit_tls(void) {
    if (!__tc_http.url[0]) return; // no begin yet — flag is kept for begin()
    if (__tc_http.client) {
        esp_http_client_cleanup(__tc_http.client);
        __tc_http.client = NULL;
    }
    esp_http_client_config_t cfg = {};
    cfg.url = __tc_http.url;
    cfg.method = __tc_http.method;
    cfg.timeout_ms = __tc_http.timeout_ms;
    cfg.event_handler = &__tc_http_event_cb;
    if (__tc_http.insecure) {
        cfg.crt_bundle_attach = NULL;
        cfg.cert_pem = NULL;
        cfg.skip_cert_common_name_check = true;
    } else if (__tc_http.ca_cert) {
        cfg.cert_pem = __tc_http.ca_cert;
    } else {
        cfg.crt_bundle_attach = esp_crt_bundle_attach;
    }
    __tc_http.client = esp_http_client_init(&cfg);
    __tc_http_apply_headers();
}

static inline void __tc_http_set_insecure(void) {
    __tc_http.insecure = true;
    __tc_http_reinit_tls();
}

static inline void __tc_http_set_ca_cert(const char* pem) {
    __tc_http.ca_cert = pem;
    __tc_http_reinit_tls();
}

static inline bool __tc_http_send(void) {
    if (!__tc_http.client) return false;
    if (__tc_http.resp) { free(__tc_http.resp); __tc_http.resp = NULL; }
    __tc_http.resp = (char*)malloc(__tc_http.max_body + 1);
    if (!__tc_http.resp) {
        __tc_http.ok = false;
        __tc_http.done = true;
        return false;
    }
    __tc_http.resp_len = 0;
    if (__tc_http.body) {
        esp_http_client_set_post_field(__tc_http.client, __tc_http.body, __tc_http.body_len);
    }
    esp_err_t err = esp_http_client_perform(__tc_http.client);
    __tc_http.resp[__tc_http.resp_len < __tc_http.max_body ? __tc_http.resp_len : __tc_http.max_body] = 0;
    __tc_http.status = esp_http_client_get_status_code(__tc_http.client);
    __tc_http.content_length = esp_http_client_get_content_length(__tc_http.client);
    __tc_http.ok = (err == ESP_OK) && __tc_http.status >= 200 && __tc_http.status < 300;
    __tc_http.done = true;
    return __tc_http.ok;
}

// Async send: perform on a worker task; poll __tc_http.done.
// 16 KB stack — TLS client hello / cert verify overflows the prior 8 KB.
static void __tc_http_send_task(void* arg) {
    (void)arg;
    __tc_http_send();
    vTaskDelete(NULL);
}

static inline void __tc_http_send_start(void) {
    __tc_http.done = false;
    xTaskCreate(__tc_http_send_task, "tc_http", 16384, NULL, 5, NULL);
}

static inline bool __tc_http_done(void) { return __tc_http.done; }
static inline int __tc_http_status(void) { return __tc_http.status; }
static inline bool __tc_http_ok(void) { return __tc_http.ok; }
static inline const char* __tc_http_body(void) { return __tc_http.resp ? __tc_http.resp : ""; }
static inline long __tc_http_content_length(void) { return (long)__tc_http.content_length; }

static inline const char* __tc_http_response_header(const char* name) {
    char* value = NULL;
    __tc_http.resp_header[0] = 0;
    if (__tc_http.client && esp_http_client_get_header(__tc_http.client, name, &value) == ESP_OK && value) {
        strlcpy(__tc_http.resp_header, value, sizeof(__tc_http.resp_header));
    }
    return __tc_http.resp_header;
}
// CUTTLEFISH_HTTP_END

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


// 10 — cooperative HTTP polling while the heartbeat keeps running.
// Http.send() lowers to a start + poll state pair: the request runs on a
// short-lived worker task while the state machine polls for completion, so
// the heartbeat never stalls during a slow request.
const __tc_str_ptr WIFI_SSID = "HomeNet";
const __tc_str_ptr WIFI_PASSWORD = "hunter22";

// Async state machine for network
class NetworkTask {
public:
  enum State { STATE_0, STATE_1, STATE_DONE };
  NetworkTask() : _state(STATE_0), _waitUntil(0) {}
  void run() {
    switch (_state) {
      case STATE_0:
        {
        __tc_wifi_connect_start(WIFI_SSID, WIFI_PASSWORD);
        _waitUntil = (unsigned long)(esp_timer_get_time() / 1000) + 15000;
        _state = STATE_1;
        }
        break;
      case STATE_1:
        {
        if ((__tc_wifi_is_connected()) || (unsigned long)(esp_timer_get_time() / 1000) >= _waitUntil) {
          printf("%s\n", __tc_wifi_local_ip());
          _state = STATE_DONE;
        }
        }
        break;
      case STATE_DONE:
        break;
    }
  }
  bool isComplete() const { return _state == STATE_DONE; }
  void reset() { _state = STATE_0; _waitUntil = 0; }
private:
  State _state;
  unsigned long _waitUntil;
};

NetworkTask networkTask;

// Async state machine for pollCloud
class PollcloudTask {
public:
  enum State { STATE_0, STATE_1, STATE_2, STATE_3 };
  PollcloudTask() : _state(STATE_0), _waitUntil(0) {}
  void run() {
    switch (_state) {
      case STATE_0:
        {
        _state = STATE_1;
        }
        break;
      case STATE_1:
        {
        if (__tc_wifi_is_connected()) {
          __tc_http_reset();
          __tc_http_begin(HTTP_METHOD_GET, "https://httpbin.org/get");
          __tc_http_send_start();
          _state = STATE_2;
        }
        }
        break;
      case STATE_2:
        {
        if (__tc_http_done()) {
          char __cuttlefish_str_1[16];
snprintf(__cuttlefish_str_1, sizeof(__cuttlefish_str_1), "%d", __tc_http_status());
printf("%s\n", __cuttlefish_str_1);
          _waitUntil = (unsigned long)(esp_timer_get_time() / 1000) + 5000;
          _state = STATE_3;
        }
        }
        break;
      case STATE_3:
        {
        if ((unsigned long)(esp_timer_get_time() / 1000) >= _waitUntil) {
          _state = STATE_0;
        }
        }
        break;
    }
  }
  bool isComplete() const { return false; }
  void reset() { _state = STATE_0; _waitUntil = 0; }
private:
  State _state;
  unsigned long _waitUntil;
};

PollcloudTask pollCloudTask;

// Async state machine for heartbeat
class HeartbeatTask {
public:
  enum State { STATE_0, STATE_1 };
  HeartbeatTask() : _state(STATE_0), _waitUntil(0) {}
  void run() {
    switch (_state) {
      case STATE_0:
        {
        gpio_set_level((gpio_num_t)2, !gpio_get_level((gpio_num_t)2));
        _waitUntil = (unsigned long)(esp_timer_get_time() / 1000) + 500;
        _state = STATE_1;
        }
        break;
      case STATE_1:
        {
        if ((unsigned long)(esp_timer_get_time() / 1000) >= _waitUntil) {
          _state = STATE_0;
        }
        }
        break;
    }
  }
  bool isComplete() const { return false; }
  void reset() { _state = STATE_0; _waitUntil = 0; }
private:
  State _state;
  unsigned long _waitUntil;
};

HeartbeatTask heartbeatTask;

// Auto-generated setup() for top-level statements
void setup()
{
  gpio_reset_pin((gpio_num_t)2); gpio_set_direction((gpio_num_t)2, GPIO_MODE_OUTPUT);
}

// Auto-generated loop() for async microtask pumping
void loop()
{
  cuttlefish_pump_microtasks();
    networkTask.run();
    pollCloudTask.run();
    heartbeatTask.run();
    cuttlefish_pump_microtasks();
}
