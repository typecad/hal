# PlatformIO Integration

TypeCode integrates with PlatformIO for professional embedded development.

## Installation

### Via pip

```bash
pip install platformio
```

### Via VS Code Extension

1. Open VS Code Extensions
2. Search for "PlatformIO IDE"
3. Click Install

### Verify Installation

```bash
pio --version
```

## Initial Setup

PlatformIO automatically downloads platforms and tools on first use. No additional setup required.

## Platform Management

### Installing Platforms

```bash
# Atmel AVR (Arduino Uno, Nano, Mega)
pio platform install atmelavr

# Atmel SAM (Arduino Zero)
pio platform install atmelsam

# ESP32
pio platform install espressif32

# ESP8266
pio platform install espressif8266

# STM32
pio platform install ststm32
```

### Listing Platforms

```bash
# Installed platforms
pio platform list

# Available platforms
pio platform search avr
```

## Project Structure

PlatformIO uses a specific project structure:

```
project/
├── platformio.ini      # Configuration
├── src/
│   └── main.cpp        # Main source
├── include/            # Header files
├── lib/                # Private libraries
└── test/               # Unit tests
```

## platformio.ini Configuration

### Basic Configuration

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
```

### Multiple Environments

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino

[env:nano]
platform = atmelavr
board = nanoatmega328
framework = arduino

[env:esp32]
platform = espressif32
board = esp32dev
framework = arduino
```

### Board Options

```ini
[env:nano]
platform = atmelavr
board = nanoatmega328
framework = arduino
board_build.f_cpu = 16000000L
board_build.mcu = atmega328p
```

### Build Flags

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
build_flags = 
  -D DEBUG=1
  -D BAUD_RATE=115200
  -O2
```

### Library Dependencies

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
lib_deps = 
  adafruit/Adafruit Sensor Library
  adafruit/Adafruit BNO055
```

## Common Commands

### Build

```bash
# Build project
pio run

# Build specific environment
pio run -e uno

# Clean build
pio run -t clean
```

### Upload

```bash
# Upload to board
pio run --target upload

# Upload to specific port
pio run --target upload --upload-port COM4

# Upload specific environment
pio run -e uno --target upload
```

### Serial Monitor

```bash
# Open serial monitor
pio device monitor

# With baud rate
pio device monitor -b 115200

# Specific port
pio device monitor -p COM4
```

### Device Management

```bash
# List devices
pio device list

# List ports only
pio device list --serial
```

## Library Management

### Installing Libraries

```bash
# Install library
pio lib install "Adafruit SSD1306"

# Install specific version
pio lib install "Adafruit SSD1306@2.5.1"

# From Git
pio lib install https://github.com/adafruit/Adafruit_SSD1306.git
```

### Library Search

```bash
# Search libraries
pio lib search "oled display"

# Show library info
pio lib show "Adafruit SSD1306"
```

### Updating Libraries

```bash
# Update all libraries
pio lib update

# Update specific library
pio lib update "Adafruit SSD1306"
```

## Board Reference

### Common Boards

| Board | Platform | Board ID |
|-------|----------|----------|
| Arduino Uno | atmelavr | `uno` |
| Arduino Nano | atmelavr | `nanoatmega328` |
| Arduino Mega | atmelavr | `megaatmega2560` |
| Arduino Zero | atmelsam | `zero` |
| ESP32 DevKit | espressif32 | `esp32dev` |
| ESP32-S3 | espressif32 | `esp32-s3-devkitc-1` |
| ESP8266 NodeMCU | espressif8266 | `nodemcuv2` |
| STM32 Blue Pill | ststm32 | `genericSTM32F103C8` |

### Search Boards

```bash
# List boards for platform
pio boards atmelavr

# Search boards
pio boards | grep -i nano
```

## TypeCode Integration

TypeCode can output PlatformIO-compatible projects:

```bash
# Generate PlatformIO project
npx typecode sketch.ts --platformio --outDir ./project
```

### Generated Structure

```
project/
├── platformio.ini      # Auto-generated config
├── src/
│   └── main.ino        # Transpiled code
└── include/
```

### Custom platformio.ini Template

In `typecode.config.ts`:

```typescript
const config = {
  output: {
    framework: 'arduino',
    outDir: './out',
  },
  platformio: {
    platform: 'atmelavr',
    board: 'uno',
    framework: 'arduino',
    lib_deps: ['adafruit/Adafruit SSD1306'],
  },
};
```

## Debugging

PlatformIO supports hardware debugging with compatible debuggers:

### Setup Debugging

```ini
[env:uno]
platform = atmelavr
board = uno
framework = arduino
debug_tool = simavr
debug_init_break = tbreak setup
```

### Debug Commands

```bash
# Start debugging
pio debug

# Debug with interface
pio debug --interface=gdb
```

## Unit Testing

PlatformIO has built-in unit testing:

```bash
# Run tests
pio test

# Test specific environment
pio test -e uno

# Test without upload (native)
pio test -e native
```

### Test Example

```cpp
// test/test_blink/test_blink.cpp
#include <unity.h>

void test_led_blink(void) {
    digitalWrite(LED_BUILTIN, HIGH);
    TEST_ASSERT_EQUAL(HIGH, digitalRead(LED_BUILTIN));
    
    digitalWrite(LED_BUILTIN, LOW);
    TEST_ASSERT_EQUAL(LOW, digitalRead(LED_BUILTIN));
}

void setup() {
    UNITY_BEGIN();
    RUN_TEST(test_led_blink);
    UNITY_END();
}

void loop() {}
```

## Troubleshooting

### Platform Installation Fails

```bash
# Clear cache and reinstall
pio platform uninstall atmelavr
pio platform install atmelavr
```

### Upload Permission Denied (Linux/macOS)

```bash
# Add user to dialout group
sudo usermod -a -G dialout $USER

# Log out and back in
```

### Board Not Detected

```bash
# List available devices
pio device list

# Check driver installation (CH340 for clones)
```

### Build Errors

```bash
# Verbose build output
pio run -v

# Clean and rebuild
pio run -t clean && pio run