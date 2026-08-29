// Hand-maintained descriptor table — mechanically migrated from the
// board-esp32s3 + mcu-esp32s3 package data (the exact flatten+reconstruct the build
// performed). Curated additions: tier/pinNaming/excludedPins. Regenerate
// only alongside a descriptor-type change (edit this file; the original
// migration script was never committed).

import type { ZephyrChipDescriptor } from '../types.js';

export const ESP32S3_SOC: ZephyrChipDescriptor = {
  "id": "esp32s3_devkitc/esp32s3/procpu",
  "soc": "esp32s3",
  "gpioController": "gpio0",
  "gpioControllers": [
    {
      "nodelabel": "gpio0",
      "minPin": 0,
      "maxPin": 31
    },
    {
      "nodelabel": "gpio1",
      "minPin": 32,
      "maxPin": 48
    }
  ],
  "gpio": {
    "dtSpecs": [
      {
        "pin": 0,
        "dtSpec": "sw0"
      }
    ],
    "interruptPins": [
      {
        "pin": 0,
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
      },
      {
        "nodeLabel": "spi3"
      }
    ]
  },
  "uart": {
    "controllers": [
      {
        "nodeLabel": "uart1",
        "pinctrlRef": "uart1_default",
        "props": [
          "current-speed = <115200>;"
        ]
      }
    ]
  },
  "pwm": {
    "specs": [],
    "matrix": {
      "controller": "ledc0",
      "channelCount": 8,
      "pins": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
        17,
        18,
        21,
        38,
        39,
        40,
        41,
        42,
        45,
        46,
        47,
        48
      ]
    },
    "maxFrequencyHz": 40000000,
    "resolutionBits": 20
  },
  "adc": {
    "nodeLabel": "adc0",
    "resolution": 12,
    "vrefMv": 1100,
    "channels": [
      {
        "pin": 1,
        "channel": 0
      },
      {
        "pin": 2,
        "channel": 1
      },
      {
        "pin": 3,
        "channel": 2
      },
      {
        "pin": 4,
        "channel": 3
      },
      {
        "pin": 5,
        "channel": 4
      },
      {
        "pin": 6,
        "channel": 5
      },
      {
        "pin": 7,
        "channel": 6
      },
      {
        "pin": 8,
        "channel": 7
      },
      {
        "pin": 9,
        "channel": 8
      },
      {
        "pin": 10,
        "channel": 9
      }
    ]
  },
  "wdt": {
    "nodeLabel": "wdt0"
  },
  "usb": {
    "controller": "zephyr_udc0",
    "cdcInstances": 1,
    "vid": "0x2FE3",
    "pid": "0x0006"
  },
  "wifi": {
    "supported": true
  },
  "tier": "validated",
  "pinNaming": "esp32-gpio",
  "excludedPins": [
    0,
    19,
    20,
    22,
    23,
    24,
    25,
    26,
    27,
    28,
    29,
    30,
    31,
    32,
    33,
    34,
    35,
    36,
    37,
    43,
    44,
    45,
    46
  ]
};
