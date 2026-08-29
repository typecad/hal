// Hand-maintained descriptor table — mechanically migrated from the
// board-esp32c6 + mcu-esp32c6 package data (the exact flatten+reconstruct the build
// performed). Curated additions: tier/pinNaming/excludedPins. Regenerate
// only alongside a descriptor-type change (edit this file; the original
// migration script was never committed).

import type { ZephyrChipDescriptor } from '../types.js';

export const ESP32C6_SOC: ZephyrChipDescriptor = {
  "id": "esp32c6_devkitc/esp32c6/hpcore",
  "soc": "esp32c6",
  "gpioController": "gpio0",
  "gpio": {
    "dtSpecs": [
      {
        "pin": 9,
        "dtSpec": "sw0"
      }
    ],
    "interruptPins": [
      {
        "pin": 9,
        "dtSpec": "sw0"
      }
    ]
  },
  "i2c": {
    "controllers": [
      {
        "nodeLabel": "i2c0"
      }
    ]
  },
  "spi": {
    "controllers": [
      {
        "nodeLabel": "spi2"
      }
    ]
  },
  "uart": {
    "controllers": [
      {
        "nodeLabel": "uart0"
      }
    ]
  },
  "adc": {
    "nodeLabel": "adc0",
    "resolution": 12,
    "vrefMv": 1100,
    "channels": [
      {
        "pin": 0,
        "channel": 0
      },
      {
        "pin": 1,
        "channel": 1
      },
      {
        "pin": 2,
        "channel": 2
      },
      {
        "pin": 3,
        "channel": 3
      },
      {
        "pin": 4,
        "channel": 4
      },
      {
        "pin": 5,
        "channel": 5
      },
      {
        "pin": 6,
        "channel": 6
      }
    ]
  },
  "wdt": {
    "nodeLabel": "wdt0"
  },
  "wifi": {
    "supported": true
  },
  "tier": "validated",
  "pinNaming": "esp32-gpio",
  "excludedPins": [
    12,
    13,
    14,
    15,
    16,
    17,
    18,
    19,
    20,
    21,
    22,
    23,
    24,
    25,
    26,
    27,
    28,
    29,
    30
  ]
};
