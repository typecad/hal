/**
 * Console polyfill template.
 * Automatically generates platform-appropriate console implementations.
 */

import { registerPolyfillTemplate, type ArchitectureCapabilities, type PolyfillTemplate } from "../template-types";

export const CONSOLE_TEMPLATE: PolyfillTemplate = {
  id: "console",
  name: "Console",
  description: "Console.log/warn/error implementation for embedded platforms",

  commonIncludes: [],

  placeholders: [
    {
      name: "SERIAL_CLASS",
      description: "Serial class name for output",
      resolve: (caps) => caps.serialClassName,
    },
    {
      name: "BAUD_RATE",
      description: "Serial baud rate",
      resolve: (caps, config) => String(config?.baudRate ?? caps.defaultBaudRate),
    },
    {
      name: "FLASH_MACRO",
      description: "Flash string macro (F, PSTR, or empty)",
      resolve: (caps) => caps.flashStringMacro,
    },
    {
      name: "USE_FLASH",
      description: "Whether to use flash strings",
      resolve: (caps, config) => (caps.flashStringMacro && config?.useFlashStrings !== false) ? "1" : "0",
    },
  ],

  variants: [
    {
      name: "arduino_serial",
      condition: (caps) => caps.serialClassName !== "" && caps.id !== "default",
      requiredCapabilities: [],
      includes: ["<Arduino.h>"],
      forwardDeclarations: [],
      code: `// Console polyfill for Arduino
class Console {
public:
    static void begin(unsigned long baud = {{BAUD_RATE}}) {
        {{SERIAL_CLASS}}.begin(baud);
    }

    static void log(const char* msg) {
#if {{USE_FLASH}}
        {{SERIAL_CLASS}}.println({{FLASH_MACRO}}(msg));
#else
        {{SERIAL_CLASS}}.println(msg);
#endif
    }

    static void log(int value) {
        {{SERIAL_CLASS}}.println(value);
    }

    static void log(long value) {
        {{SERIAL_CLASS}}.println(value);
    }

    static void log(double value) {
        {{SERIAL_CLASS}}.println(value);
    }

    static void warn(const char* msg) {
        {{SERIAL_CLASS}}.print(F("[WARN] "));
        log(msg);
    }

    static void error(const char* msg) {
        {{SERIAL_CLASS}}.print(F("[ERROR] "));
        log(msg);
    }

    template<typename T>
    static void log(T value) {
        {{SERIAL_CLASS}}.println(value);
    }
};

// Global console instance
static Console console;

// Convenience macros
#define console_log(msg) console.log(msg)
#define console_warn(msg) console.warn(msg)
#define console_error(msg) console.error(msg)
`,
    },
    {
      name: "iostream",
      condition: (caps) => caps.hasIostream && caps.serialClassName === "",
      requiredCapabilities: ["hasIostream"],
      includes: ["<iostream>"],
      forwardDeclarations: [],
      code: `// Console polyfill using std::cout
#include <iostream>

class Console {
public:
    static void log(const char* msg) {
        std::cout << msg << std::endl;
    }

    static void log(int value) {
        std::cout << value << std::endl;
    }

    static void log(long value) {
        std::cout << value << std::endl;
    }

    static void log(double value) {
        std::cout << value << std::endl;
    }

    static void warn(const char* msg) {
        std::cout << "[WARN] " << msg << std::endl;
    }

    static void error(const char* msg) {
        std::cout << "[ERROR] " << msg << std::endl;
    }

    template<typename T>
    static void log(T value) {
        std::cout << value << std::endl;
    }
};

static Console console;
`,
    },
    {
      name: "stub",
      condition: (caps) => !caps.hasIostream && caps.serialClassName === "",
      requiredCapabilities: [],
      includes: [],
      forwardDeclarations: [],
      code: `// Console stub - no output available
class Console {
public:
    static void begin(unsigned long baud = 0) { }
    static void log(const char* msg) { }
    static void log(int value) { }
    static void log(long value) { }
    static void log(double value) { }
    static void warn(const char* msg) { }
    static void error(const char* msg) { }
    template<typename T> static void log(T value) { }
};

static Console console;
`,
    },
  ],
};

// Auto-register
registerPolyfillTemplate(CONSOLE_TEMPLATE);