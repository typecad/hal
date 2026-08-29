// Hand-maintained descriptor table — mechanically migrated from the
// board-rp2350 + mcu-rp2350 package data (the exact flatten+reconstruct the build
// performed). Curated additions: tier/pinNaming/excludedPins. Regenerate
// only alongside a descriptor-type change (edit this file; the original
// migration script was never committed).

import type { ZephyrChipDescriptor } from '../types.js';

export const RP2350A_SOC: ZephyrChipDescriptor = {
  "id": "rpi_pico2/rp2350a/m33",
  "soc": "rp2350a",
  "gpioController": "gpio0",
  "gpio": {
    "dtSpecs": [
      {
        "pin": 25,
        "dtSpec": "led0"
      }
    ]
  },
  "i2c": {
    "controllers": [
      {
        "nodeLabel": "i2c0"
      },
      {
        "nodeLabel": "i2c1"
      }
    ]
  },
  "spi": {
    "controllers": [
      {
        "nodeLabel": "spi0"
      },
      {
        "nodeLabel": "spi1"
      }
    ]
  },
  "uart": {
    "controllers": [
      {
        "nodeLabel": "uart0"
      },
      {
        "nodeLabel": "uart1",
        "pinctrl": {
          "include": "zephyr/dt-bindings/pinctrl/rpi-pico-rp2350a-pinctrl.h",
          "pinmux": [
            "UART1_TX_P22"
          ],
          "inputPinmux": [
            "UART1_RX_P23"
          ],
          "defines": [
            "RP2_PINCTRL_GPIO_FUNC_UART_ALT 11"
          ]
        },
        "props": [
          "current-speed = <115200>;"
        ]
      }
    ]
  },
  "pwm": {
    "specs": [
      {
        "pin": 25,
        "controller": "pwm",
        "channel": 9
      }
    ],
    "maxFrequencyHz": 75000000,
    "resolutionBits": 16
  },
  "adc": {
    "nodeLabel": "adc",
    "resolution": 12,
    "vrefMv": 3300,
    "channels": [
      {
        "pin": 26,
        "channel": 0
      },
      {
        "pin": 27,
        "channel": 1
      },
      {
        "pin": 28,
        "channel": 2
      },
      {
        "pin": 29,
        "channel": 3
      }
    ]
  },
  "wdt": {
    "nodeLabel": "wdt0"
  },
  "storage": {
    "offset": 3145728,
    "size": 1048576
  },
  "usb": {
    "controller": "zephyr_udc0",
    "cdcInstances": 1,
    "vid": "0x2FE3",
    "pid": "0x0005"
  },
  "consoleDescription": "uart0 on GP0 (TX) / GP1 (RX)",
  "probeMethods": [
    {
      "id": "uf2",
      "runner": "uf2",
      "description": "BOOTSEL UF2 bootloader: hold BOOTSEL while plugging in USB (no debug)",
      "debug": false
    },
    {
      "id": "openocd",
      "runner": "openocd",
      "description": "Any CMSIS-DAP-class SWD probe on the SWD header (m33 core) — also debugs",
      "debug": true,
      "debugInterface": "swd",
      "debugCfgSource": [
        "interface/cmsis-dap.cfg",
        "target/rp2350.cfg"
      ]
    },
    {
      "id": "jlink",
      "runner": "jlink",
      "description": "J-Link probe (SWD) — also debugs",
      "debug": true,
      "debugInterface": "swd",
      "debugDevice": "RP2350_M33_0"
    }
  ],
  "tier": "validated",
  "pinNaming": "rp-gpio",
  "excludedPins": [
    23,
    24,
    47
  ]
};
