// types.h
#include <stdint.h>

typedef enum {
  MODE_OFF = 0,
  MODE_ON,        /* 1 */
  MODE_AUTO = 5,
} device_mode_t;

typedef struct {
  int slot;
  uint8_t flags;
} device_config_t;

typedef struct device *device_handle_t;

device_handle_t device_open(const device_config_t *cfg);
device_mode_t device_get_mode(device_handle_t h);
