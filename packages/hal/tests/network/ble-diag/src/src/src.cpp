#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/uuid.h>
#include <stdio.h>
#include <stdlib.h>

// typecad-hal runtime shim. Wrapped in a single include guard so the
// block is safe to emit into multiple headers and .cpp files within
// one translation unit (a .cpp may #include several headers that each
// carry the shim). The guard ensures the definitions are seen exactly
// once per TU.
#ifndef CUTTLEFISH_SHIM_DEFINED
#define CUTTLEFISH_SHIM_DEFINED
inline void __tc_print(const char* s) { printf("%s", s); }
static void __tc_fmt_num(double v) {
    if (v != v) { printf("nan"); return; }
    double a = v < 0 ? -v : v;
    long long ip = (long long)a;
    long long fr = (long long)((a - (double)ip) * 1000000.0 + 0.5);
    if (fr >= 1000000LL) { ip += 1LL; fr = 0LL; }
    if (v < 0 && (ip != 0LL || fr != 0LL)) printf("-");
    if (fr == 0LL) { printf("%lld", ip); return; }
    char fbuf[8];
    int len = snprintf(fbuf, sizeof(fbuf), "%06lld", fr);
    while (len > 0 && fbuf[len - 1] == '0') { fbuf[--len] = '\0'; }
    printf("%lld.%s", ip, fbuf);
}
inline void __tc_print(double v) { __tc_fmt_num(v); }
inline void __tc_println(const char* s) { printf("%s\n", s); }
inline void __tc_println(double v) { __tc_fmt_num(v); printf("\n"); }
// CUTTLEFISH_BLE_BEGIN
#define __TC_BLE_MAX_CHARS 16
#define __TC_BLE_MAX_SVCS 8
// Max attrs: per service (1 primary) + per char (2) + per notify char (1 CCC).
// Worst case: all chars in one service, all notify: 1 + 2*16 + 16 = 49.
#define __TC_BLE_MAX_ATTRS (1 + (2 * __TC_BLE_MAX_CHARS) + __TC_BLE_MAX_CHARS)

// Read handlers are stored as void* and cast based on the char's type.
typedef int  (*__tc_ble_read_int_cb_t)(void);
typedef double (*__tc_ble_read_dbl_cb_t)(void);
typedef const char* (*__tc_ble_read_str_cb_t)(void);
typedef void (*__tc_ble_write_cb_t)(double value);
typedef void (*__tc_ble_event_cb_t)(void);

// Deferred characteristic definition (populated before __tc_ble_server_begin).
typedef struct {
    const char* uuid_str;    // raw UUID string ("2A6E" or full 128-bit)
    bool uuid_is_128;
    int perms;               // bitmask: READ=1, WRITE=2, NOTIFY=4
    int svc_index;
    const char* type;        // value type: "int16", "uint8", "float32", "utf8", etc.
} __tc_ble_char_def_t;

static struct {
    int status;                // BleStatus enum
    bool inited;
    bool advertising;
    int connected_clients;
    struct bt_conn* conn;      // active connection (NULL = none)
    uint16_t svc_count;
    int current_char;          // set by add_char, read by on_read/on_write
    void* on_read[__TC_BLE_MAX_CHARS];    // typed fn pointer, cast by char type
    __tc_ble_write_cb_t on_write[__TC_BLE_MAX_CHARS];
    // value-attr index per char (the 2nd attr of BT_GATT_CHARACTERISTIC),
    // used by notify to pass the registered attr to bt_gatt_notify.
    int val_attr_idx[__TC_BLE_MAX_CHARS];
    __tc_ble_event_cb_t on_connect;
    __tc_ble_event_cb_t on_disconnect;
    char name[32];
} __tc_ble = { 0, false, false, 0, NULL, 0, 0, {}, {}, {}, NULL, NULL, {} };

static __tc_ble_char_def_t __tc_ble_char_defs[__TC_BLE_MAX_CHARS];
static int __tc_ble_char_count = 0;
static const char* __tc_ble_svc_uuids[__TC_BLE_MAX_SVCS];

// Static pools for the synthesized GATT attribute table.
// UUID objects + the attr array must persist for the lifetime of the stack.
static struct bt_uuid_16  __tc_ble_svc_uuid16_objs[__TC_BLE_MAX_SVCS];
static struct bt_uuid_128 __tc_ble_svc_uuid128_objs[__TC_BLE_MAX_SVCS];
static struct bt_uuid_16  __tc_ble_chr_uuid16_objs[__TC_BLE_MAX_CHARS];
static struct bt_uuid_128 __tc_ble_chr_uuid128_objs[__TC_BLE_MAX_CHARS];
// bt_gatt_chrc metadata for each characteristic declaration attr.
static struct bt_gatt_chrc __tc_ble_chrc_meta[__TC_BLE_MAX_CHARS];
// The flat attribute array + its wrapping service. Plus per-char CCC cfg.
static struct bt_gatt_ccc_managed_user_data __tc_ble_ccc[__TC_BLE_MAX_CHARS];
static void __tc_ble_ccc_changed(const struct bt_gatt_attr* a, uint16_t v) { (void)a; printk("tc-ble: ccc value=%u" "\n", (unsigned)v); }
static struct bt_gatt_attr __tc_ble_attrs[__TC_BLE_MAX_ATTRS];
static size_t __tc_ble_attr_count = 0;
static struct bt_gatt_service __tc_ble_svc;

// ── UUID helpers ──
static bool __tc_ble_uuid_is_128(const char* s) { return strchr(s, '-') != NULL; }

// Parse a canonical "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" into the 16-byte
// little-endian val array of bt_uuid_128 (Bluetooth Core Spec LE byte order).
static void __tc_ble_uuid128_parse(uint8_t* value, const char* u) {
    int bi = 0;
    for (int i = 0; u[i] && bi < 16; i++) {
        if (u[i] == '-') continue;
        char hex[3] = {u[i], u[i+1], 0};
        value[15 - bi] = static_cast<uint8_t>(strtol(hex, NULL, 16));
        bi++;
        i++;
    }
}

static const struct bt_uuid* __tc_ble_make_svc_uuid(int s) {
    const char* u = __tc_ble_svc_uuids[s];
    if (__tc_ble_uuid_is_128(u)) {
        __tc_ble_svc_uuid128_objs[s].uuid.type = BT_UUID_TYPE_128;
        __tc_ble_uuid128_parse(__tc_ble_svc_uuid128_objs[s].val, u);
        return &__tc_ble_svc_uuid128_objs[s].uuid;
    }
    __tc_ble_svc_uuid16_objs[s].uuid.type = BT_UUID_TYPE_16;
    __tc_ble_svc_uuid16_objs[s].val = static_cast<uint16_t>(strtol(u, NULL, 16));
    return &__tc_ble_svc_uuid16_objs[s].uuid;
}

static const struct bt_uuid* __tc_ble_make_chr_uuid(int c) {
    const char* u = __tc_ble_char_defs[c].uuid_str;
    if (__tc_ble_char_defs[c].uuid_is_128) {
        __tc_ble_chr_uuid128_objs[c].uuid.type = BT_UUID_TYPE_128;
        __tc_ble_uuid128_parse(__tc_ble_chr_uuid128_objs[c].val, u);
        return &__tc_ble_chr_uuid128_objs[c].uuid;
    }
    __tc_ble_chr_uuid16_objs[c].uuid.type = BT_UUID_TYPE_16;
    __tc_ble_chr_uuid16_objs[c].val = static_cast<uint16_t>(strtol(u, NULL, 16));
    return &__tc_ble_chr_uuid16_objs[c].uuid;
}

// ── GATT read/write dispatchers ──
// A single pair registered as every value-attribute's read/write callback.
// The char index is recovered from attr->user_data (set during table build).
static ssize_t __tc_ble_attr_read(struct bt_conn* conn, const struct bt_gatt_attr* attr,
                                  void* buf, uint16_t len, uint16_t offset) {
    (void)conn; (void)len;
    int idx = attr && attr->user_data ? static_cast<int>(reinterpret_cast<intptr_t>(attr->user_data)) : 0;
    if (idx < 0 || idx >= __TC_BLE_MAX_CHARS || !__tc_ble.on_read[idx]) return 0;
    const char* t = __tc_ble_char_defs[idx].type;
    if (t && strcmp(t, "utf8") == 0) {
        // Hoisted string callbacks return std::string BY VALUE — call through
        // the true signature and borrow c_str() for the copy below.
        std::string s_v = reinterpret_cast<std::string(*)(void)>(__tc_ble.on_read[idx])();
        return bt_gatt_attr_read(conn, attr, buf, len, offset, s_v.c_str(), s_v.size());
    } else if (t && strcmp(t, "float32") == 0) {
        double d = reinterpret_cast<double(*)(void)>(__tc_ble.on_read[idx])();
        float f = static_cast<float>(d);
        return bt_gatt_attr_read(conn, attr, buf, len, offset, &f, sizeof(f));
    } else if (t && strcmp(t, "uint32") == 0) {
        // Hoisted read callbacks return double (TS number -> C++ double).
        // Calling a double-returning fn through an int-returning pointer is
        // UB: on ARM the low word of the double in r0:r1 is 0 for small
        // temperatures, so every read came back 0 (nRF Connect: 0.0C).
        double dv = reinterpret_cast<double(*)(void)>(__tc_ble.on_read[idx])();
        uint32_t u = static_cast<uint32_t>(dv);
        return bt_gatt_attr_read(conn, attr, buf, len, offset, &u, sizeof(u));
    } else if (t && strcmp(t, "boolean") == 0) {
        double dv = reinterpret_cast<double(*)(void)>(__tc_ble.on_read[idx])();
        uint8_t b = dv != 0 ? 1 : 0;
        return bt_gatt_attr_read(conn, attr, buf, len, offset, &b, sizeof(b));
    }
    // uint8/16, int8/16/32 → int16 default.
    double dv = reinterpret_cast<double(*)(void)>(__tc_ble.on_read[idx])();
    int16_t s16 = static_cast<int16_t>(dv);
    return bt_gatt_attr_read(conn, attr, buf, len, offset, &s16, sizeof(s16));
}

static ssize_t __tc_ble_attr_write(struct bt_conn* conn, const struct bt_gatt_attr* attr,
                                   const void* buf, uint16_t len, uint16_t offset, uint8_t flags) {
    (void)conn; (void)offset; (void)flags;
    int idx = attr && attr->user_data ? static_cast<int>((intptr_t)attr->user_data) : 0;
    if (idx < 0 || idx >= __TC_BLE_MAX_CHARS || !__tc_ble.on_write[idx]) return len;
    const char* wt = __tc_ble_char_defs[idx].type;
    const uint8_t* data = static_cast<const uint8_t*>(buf);
    int cb_val = 0;
    if (wt && strcmp(wt, "utf8") == 0) {
        cb_val = (len >= 1) ? data[0] : 0;
    } else if (wt && strcmp(wt, "uint32") == 0) {
        uint32_t u = 0;
        if (len >= sizeof(u)) memcpy(&u, data, sizeof(u));
        cb_val = static_cast<int>(u);
    } else if (wt && strcmp(wt, "float32") == 0) {
        float f = 0;
        if (len >= sizeof(f)) memcpy(&f, data, sizeof(f));
        cb_val = static_cast<int>(f);
    } else {
        int16_t s16 = 0;
        if (len >= sizeof(s16)) memcpy(&s16, data, sizeof(s16));
        cb_val = s16;
    }
    __tc_ble.on_write[idx](cb_val);
    return len;
}

// ── Connect/disconnect callbacks ──
static void __tc_ble_connected(struct bt_conn* conn, uint8_t err) {
    printk("tc-ble: connected cb err=%u\n", (unsigned)err);
    if (err == 0) {
        __tc_ble.conn = bt_conn_ref(conn);
        __tc_ble.connected_clients = __tc_ble.connected_clients + 1;
        __tc_ble.status = 3; // Connected
        if (__tc_ble.on_connect) __tc_ble.on_connect();
    }
}
static void __tc_ble_disconnected(struct bt_conn* conn, uint8_t reason) {
    printk("tc-ble: disconnected cb reason=%u\n", (unsigned)reason);
    (void)reason;
    if (__tc_ble.conn) { bt_conn_unref(__tc_ble.conn); __tc_ble.conn = NULL; }
    if (__tc_ble.on_disconnect) __tc_ble.on_disconnect();
    __tc_ble.connected_clients = __tc_ble.connected_clients > 0 ? __tc_ble.connected_clients - 1 : 0;
    __tc_ble.status = 2; // Advertising
}
static struct bt_conn_cb __tc_ble_conn_cb = {
    .connected = __tc_ble_connected,
    .disconnected = __tc_ble_disconnected,
};

// ── Advertising ──
static void __tc_ble_advertise_start(void) {
    if (!__tc_ble.inited) return;
    const char* n = __tc_ble.name[0] ? __tc_ble.name : "TypeCAD";
    size_t nlen = strlen(n);
    struct bt_data ad[2];
    ad[0].type = BT_DATA_FLAGS;
    ad[0].data_len = 1;
    static const uint8_t __tc_ble_flags = (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR);
    ad[0].data = &__tc_ble_flags;
    ad[1].type = BT_DATA_NAME_COMPLETE;
    ad[1].data_len = static_cast<uint8_t>(nlen > 255 ? 255 : nlen);
    ad[1].data = reinterpret_cast<const uint8_t*>(n);
    int rc = bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, ad, 2, NULL, 0);
    if (rc != 0 && rc != -EALREADY && rc != -EBUSY) { printk("ble adv_start rc=%d\n", rc); }
    __tc_ble.advertising = true;
    __tc_ble.status = 2;
}

static void __tc_ble_advertise_stop(void) {
    bt_le_adv_stop();
    __tc_ble.advertising = false;
}

// ── Deferred graph builders ──
static void __tc_ble_add_service(const char* uuid_str) {
    if (__tc_ble.svc_count < __TC_BLE_MAX_SVCS) {
        __tc_ble_svc_uuids[__tc_ble.svc_count] = uuid_str;
        __tc_ble.svc_count++;
    }
}

static void __tc_ble_add_char(int idx, const char* uuid_str, const char* type, int perms, int svc_index) {
    if (idx < 0 || idx >= __TC_BLE_MAX_CHARS) return;
    __tc_ble_char_defs[idx].uuid_str = uuid_str;
    __tc_ble_char_defs[idx].uuid_is_128 = __tc_ble_uuid_is_128(uuid_str);
    __tc_ble_char_defs[idx].perms = perms;
    __tc_ble_char_defs[idx].svc_index = svc_index;
    __tc_ble_char_defs[idx].type = type;
    __tc_ble.current_char = idx;
    if (idx + 1 > __tc_ble_char_count) __tc_ble_char_count = idx + 1;
}

// ── GATT table builder (flat bt_gatt_attr[] for Zephyr runtime registration) ──
// Emits: 1 primary-service attr per service; 2 attrs per characteristic
// (declaration + value); the value attr carries the char index in user_data.
static void __tc_ble_build_svc_table(void) {
    size_t a = 0;
    for (int c = 0; c < __TC_BLE_MAX_CHARS; c++) { __tc_ble_ccc[c].cfg_changed = __tc_ble_ccc_changed; }
    for (int s = 0; s < static_cast<int>(__tc_ble.svc_count); s++) {
        // Primary service declaration.
        __tc_ble_attrs[a].uuid = BT_UUID_GATT_PRIMARY;
        __tc_ble_attrs[a].read = bt_gatt_attr_read_service;
        __tc_ble_attrs[a].write = NULL;
        __tc_ble_attrs[a].user_data = static_cast<void*>(const_cast<struct bt_uuid*>(__tc_ble_make_svc_uuid(s)));
        __tc_ble_attrs[a].handle = 0;
        __tc_ble_attrs[a].perm = BT_GATT_PERM_READ;
        a++;
        for (int c = 0; c < __tc_ble_char_count; c++) {
            if (__tc_ble_char_defs[c].svc_index != s || !__tc_ble_char_defs[c].uuid_str) continue;
            // Characteristic declaration attr.
            __tc_ble_chrc_meta[c].uuid = __tc_ble_make_chr_uuid(c);
            __tc_ble_chrc_meta[c].value_handle = 0;
            uint8_t props = 0;
            if (__tc_ble_char_defs[c].perms & 1) props |= BT_GATT_CHRC_READ;
            if (__tc_ble_char_defs[c].perms & 2) props |= BT_GATT_CHRC_WRITE;
            if (__tc_ble_char_defs[c].perms & 4) props |= BT_GATT_CHRC_NOTIFY;
            __tc_ble_chrc_meta[c].properties = props;
            __tc_ble_attrs[a].uuid = BT_UUID_GATT_CHRC;
            __tc_ble_attrs[a].read = bt_gatt_attr_read_chrc;
            __tc_ble_attrs[a].write = NULL;
            __tc_ble_attrs[a].user_data = &__tc_ble_chrc_meta[c];
            __tc_ble_attrs[a].handle = 0;
            __tc_ble_attrs[a].perm = BT_GATT_PERM_READ;
            a++;
            // Characteristic value attr — the index goes in user_data.
            __tc_ble_attrs[a].uuid = __tc_ble_make_chr_uuid(c);
            __tc_ble_attrs[a].read = __tc_ble_attr_read;
            __tc_ble_attrs[a].write = __tc_ble_attr_write;
            __tc_ble_attrs[a].user_data = reinterpret_cast<void*>(static_cast<intptr_t>(c));
            __tc_ble_attrs[a].handle = 0;
            __tc_ble_attrs[a].perm = BT_GATT_PERM_READ | BT_GATT_PERM_WRITE;
            __tc_ble.val_attr_idx[c] = static_cast<int>(a);
            a++;
            if (__tc_ble_char_defs[c].perms & 4) {
                // CCC descriptor — without it a central cannot subscribe
                // and notifications never reach anyone.
                __tc_ble_attrs[a].uuid = BT_UUID_GATT_CCC;
                __tc_ble_attrs[a].read = bt_gatt_attr_read_ccc;
                __tc_ble_attrs[a].write = bt_gatt_attr_write_ccc;
                __tc_ble_attrs[a].user_data = &__tc_ble_ccc[c];
                __tc_ble_attrs[a].handle = 0;
                __tc_ble_attrs[a].perm = BT_GATT_PERM_READ | BT_GATT_PERM_WRITE;
                a++;
            }
        }
    }
    __tc_ble_attr_count = a;
    __tc_ble_svc.attrs = __tc_ble_attrs;
    __tc_ble_svc.attr_count = a;
    printk("tc-ble: table built svc_count=%u attr_count=%u char_count=%u" "\n",
           (unsigned)__tc_ble.svc_count, (unsigned)a, (unsigned)__tc_ble_char_count);
    for (int c = 0; c < __tc_ble_char_count; c++) {
        printk("tc-ble: char[%d] uuid=%s svc=%d perms=%d" "\n", c,
               __tc_ble_char_defs[c].uuid_str, __tc_ble_char_defs[c].svc_index, __tc_ble_char_defs[c].perms);
    }
}

// ── Server begin: build table, register (before bt_enable), enable, advertise ──
static void __tc_ble_server_begin(const char* name) {
    if (__tc_ble.inited) return;
    strncpy(__tc_ble.name, name, sizeof(__tc_ble.name) - 1); __tc_ble.name[sizeof(__tc_ble.name) - 1] = 0;
    // If no service was added but characteristics exist, default to one service.
    if (__tc_ble.svc_count == 0 && __tc_ble_char_count > 0) {
        for (int c = 0; c < __tc_ble_char_count; c++) __tc_ble_char_defs[c].svc_index = 0;
        __tc_ble_add_service("181A"); // Environmental Sensing
    }
    __tc_ble_build_svc_table();
    bt_conn_cb_register(&__tc_ble_conn_cb);
    // Register BEFORE bt_enable (the supported timing window).
    bt_gatt_service_register(&__tc_ble_svc);
    __tc_ble.status = 1; // Initializing
    int __rc = bt_enable(NULL);  // synchronous
    printk("tc-ble: bt_enable rc=%d\n", __rc);
    __tc_ble.inited = true;
    __tc_ble_advertise_start();
}

// ── Notify ──
// Explicit-conn: the NULL (broadcast) form hit an ESP32 controller assert
// (lld_con.c) on the first push after subscription on the S3.
static void __tc_ble_notify(int idx, int16_t value) {
    if (idx < 0 || idx >= __TC_BLE_MAX_CHARS) return;
    int ai = __tc_ble.val_attr_idx[idx];
    if (ai == 0) return;
    const char* t = __tc_ble_char_defs[idx].type;
    if (t && strcmp(t, "uint32") == 0) {
        uint32_t u = static_cast<uint32_t>(value); bt_gatt_notify(__tc_ble.conn, &__tc_ble_attrs[ai], &u, sizeof(u));
    } else if (t && strcmp(t, "float32") == 0) {
        float f = static_cast<float>(value); bt_gatt_notify(__tc_ble.conn, &__tc_ble_attrs[ai], &f, sizeof(f));
    } else if (t && strcmp(t, "boolean") == 0) {
        uint8_t b = value ? 1 : 0; bt_gatt_notify(__tc_ble.conn, &__tc_ble_attrs[ai], &b, sizeof(b));
    } else {
        int16_t s16 = value; bt_gatt_notify(__tc_ble.conn, &__tc_ble_attrs[ai], &s16, sizeof(s16));
    }
}

static inline bool __tc_ble_is_connected(void) {
    return __tc_ble.status == 3 && __tc_ble.connected_clients > 0;
}
static inline int __tc_ble_client_count(void) { return __tc_ble.connected_clients; }

// CUTTLEFISH_BLE_END

#endif // CUTTLEFISH_SHIM_DEFINED

#include "src.h"
# 7 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
double setpoint = 2000;
# 9 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
double connects = 0;

# 8 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
static void onSetpointWrite(double value);
# 10 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
static void onBleConnect();

double main_isr_0() {
# 12 "C:/typecad/typecode/packages/hal/tests/network/ble-diag"
  return 2180;
}

double main_isr_1() {
# 14 "C:/typecad/typecode/packages/hal/tests/network/ble-diag"
  return setpoint;
}

double main_isr_2() {
# 16 "C:/typecad/typecode/packages/hal/tests/network/ble-diag"
  return 2200;
}

double main_isr_3() {
# 17 "C:/typecad/typecode/packages/hal/tests/network/ble-diag"
  return 5500;
}

double main_isr_4() {
# 18 "C:/typecad/typecode/packages/hal/tests/network/ble-diag"
  return 87;
}

double main_isr_5() {
# 19 "C:/typecad/typecode/packages/hal/tests/network/ble-diag"
  return 42;
}

std::string main_isr_6() {
# 20 "C:/typecad/typecode/packages/hal/tests/network/ble-diag"
  return "typecad-hal-ble";
}

# 8 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
static void onSetpointWrite(double value)
{
  setpoint = value;
}

# 10 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
static void onBleConnect()
{
  connects = connects + 1;
}

// Auto-generated main() for top-level statements
# 2 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
int main()
{
# 12 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  {
    __tc_ble_add_char(0, "2A6E", "int16", 1, 0);
    __tc_ble.on_read[__tc_ble.current_char] = reinterpret_cast<void*>(main_isr_0);
  }
# 13 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  {
    __tc_ble_add_char(1, "2A1F", "int16", 3, 0);
    __tc_ble.on_read[__tc_ble.current_char] = reinterpret_cast<void*>(main_isr_1);
    __tc_ble.on_write[__tc_ble.current_char] = (onSetpointWrite);
  }
# 16 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  {
    __tc_ble_add_char(2, "2A58", "int16", 5, 0);
    __tc_ble.on_read[__tc_ble.current_char] = reinterpret_cast<void*>(main_isr_2);
  }
# 17 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  {
    __tc_ble_add_char(3, "2A6F", "uint16", 1, 0);
    __tc_ble.on_read[__tc_ble.current_char] = reinterpret_cast<void*>(main_isr_3);
  }
# 18 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  {
    __tc_ble_add_char(4, "2A19", "uint8", 1, 0);
    __tc_ble.on_read[__tc_ble.current_char] = reinterpret_cast<void*>(main_isr_4);
  }
# 19 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  {
    __tc_ble_add_char(5, "a1b2c3d4-0010-1000-8000-00805f9b34fb", "uint8", 1, 0);
    __tc_ble.on_read[__tc_ble.current_char] = reinterpret_cast<void*>(main_isr_5);
  }
# 20 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  {
    __tc_ble_add_char(6, "a1b2c3d4-0011-1000-8000-00805f9b34fb", "utf8", 1, 0);
    __tc_ble.on_read[__tc_ble.current_char] = reinterpret_cast<void*>(main_isr_6);
  }
# 21 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  __tc_ble.on_connect = (onBleConnect);
# 23 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  {
    __tc_ble_server_begin("CuttlefishTest");
    __tc_ble_advertise_start();
  }
# 24 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  __tc_println("diag: server started");
# 26 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  while (true)
  {
# 27 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
    char __cuttlefish_str_1[99];
    snprintf(__cuttlefish_str_1, sizeof(__cuttlefish_str_1), "diag: linked=%d clients=%d setpoint=%.15g connects=%.15g", ((__tc_ble_is_connected() ? 1 : 0)), __tc_ble_client_count(), setpoint, connects);
    __tc_println(__cuttlefish_str_1);
# 28 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
    if (__tc_ble_is_connected())
    {
# 29 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
      __tc_ble_notify(2, 2200);
    }
# 31 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
    k_msleep(2000);
  }
# 2 "C:/typecad/typecode/packages/hal/tests/network/ble-diag/src/main.ts"
  return 0;
}
