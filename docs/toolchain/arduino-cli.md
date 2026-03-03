# Arduino CLI Integration

TypeCode integrates with the official Arduino CLI for compilation and upload.

## Installation

### Windows

```powershell
# Via scoop
scoop install arduino-cli

# Via Chocolatey
choco install arduino-cli

# Manual download
# Download from https://github.com/arduino/arduino-cli/releases
```

### macOS

```bash
# Via Homebrew
brew install arduino-cli

# Manual
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
```

### Linux

```bash
# Via script
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh

# Via Snap
snap install arduino-cli
```

## Initial Setup

After installation, initialize the configuration:

```bash
arduino-cli config init
```

Update the core index:

```bash
arduino-cli core update-index
```

## Installing Cores

Install cores for your boards:

```bash
# AVR boards (Uno, Nano, Mega)
arduino-cli core install arduino:avr

# SAMD boards (Zero, Nano 33 IoT)
arduino-cli core install arduino:samd

# ESP32 boards
arduino-cli core install esp32:esp32

# ESP8266 boards
arduino-cli core install esp8266:esp8266
```

## Installing Libraries

```bash
# Install library
arduino-cli lib install Servo

# Install specific version
arduino-cli lib install Servo@1.1.8

# List installed libraries
arduino-cli lib list

# Update libraries
arduino-cli lib upgrade
```

## Common Commands

### Compile

```bash
# Basic compile
arduino-cli compile --fqbn arduino:avr:uno sketch/

# With warnings
arduino-cli compile --fqbn arduino:avr:uno --warnings all sketch/

# With optimization
arduino-cli compile --fqbn arduino:avr:uno --optimize sketch/

# Export to specific directory
arduino-cli compile --fqbn arduino:avr:uno --build-property build.path=./out sketch/
```

### Upload

```bash
# Upload to board
arduino-cli upload -p COM4 --fqbn arduino:avr:uno sketch/

# With programmer
arduino-cli upload -p COM4 --fqbn arduino:avr:uno --programmer usbasp sketch/

# Verify after upload
arduino-cli upload -p COM4 --fqbn arduino:avr:uno --verify sketch/
```

### Board Management

```bash
# List connected boards
arduino-cli board list

# List all supported boards
arduino-cli board listall

# Attach board to sketch
arduino-cli board attach serial:COM4 sketch/
```

### Serial Monitor

```bash
# Open serial monitor
arduino-cli monitor -p COM4 -c baudrate=115200
```

## FQBN Reference

Fully Qualified Board Name format:

```
<package>:<architecture>:<board>[:<options>]
```

### Common FQBNs

| Board | FQBN |
|-------|------|
| Arduino Uno | `arduino:avr:uno` |
| Arduino Nano | `arduino:avr:nano` |
| Arduino Nano (328) | `arduino:avr:nano:cpu=atmega328` |
| Arduino Mega | `arduino:avr:mega` |
| Arduino Zero | `arduino:samd:zero` |
| Arduino Nano 33 IoT | `arduino:samd:nano_33_iot` |
| ESP32 DevKit | `esp32:esp32:esp32doit-devkit-v1` |
| ESP32-S3 | `esp32:esp32:esp32s3box` |
| ESP8266 NodeMCU | `esp8266:esp8266:nodemcu` |

### Board Options

List options for a board:

```bash
arduino-cli board details --fqbn arduino:avr:nano
```

Output includes available options:

```
Option: Processor
  cpu=atmega328     (ATmega328P)
  cpu=atmega328old  (ATmega328P (Old Bootloader))
  cpu=atmega168     (ATmega168)
```

Use options in FQBN:

```bash
arduino-cli compile --fqbn arduino:avr:nano:cpu=atmega328old sketch/
```

## Configuration

### Config File Location

- Linux: `~/.arduino15/arduino-cli.yaml`
- macOS: `~/.arduino15/arduino-cli.yaml`
- Windows: `%USERPROFILE%\.arduino15\arduino-cli.yaml`

### Adding Board URLs

Add third-party board URLs:

```bash
arduino-cli config add board_manager.additional_urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
arduino-cli config add board_manager.additional_urls https://raw.githubusercontent.com/esp8266/Arduino/gh-pages/package_esp8266com_index.json
arduino-cli core update-index
```

### Example Configuration

```yaml
board_manager:
  additional_urls:
    - https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
    - https://raw.githubusercontent.com/esp8266/Arduino/gh-pages/package_esp8266com_index.json

directories:
  data: ~/.arduino15
  downloads: ~/.arduino15/staging
  user: ~/Arduino
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ARDUINO_DATA_DIR` | Data directory |
| `ARDUINO_DOWNLOADS_DIR` | Download directory |
| `ARDUINO_SKETCHBOOK_DIR` | Sketchbook directory |
| `ARDUINO_BUILD_CACHE_COMPILATIONS_BEFORE_PURGE` | Build cache size |

## TypeCode Integration

TypeCode uses Arduino CLI automatically when you use `--compile`:

```bash
npx typecode sketch.ts --compile --fqbn arduino:avr:uno
```

### Custom Arduino CLI Path

```bash
# Set path in environment
export ARDUINO_CLI_PATH=/path/to/arduino-cli

# Or in typecode.config.ts
const config = {
  toolchain: {
    name: 'arduino-cli',
    path: '/custom/path/to/arduino-cli',
  },
};
```

## Troubleshooting

### Permission Denied (Linux/macOS)

```bash
# Add user to dialout group
sudo usermod -a -G dialout $USER

# Log out and back in
```

### Port Not Found

```bash
# List available ports
ls /dev/tty*

# Check permissions
ls -la /dev/ttyACM0
```

### Old Bootloader (Nano)

Some Nano clones use the old bootloader:

```bash
arduino-cli compile --fqbn arduino:avr:nano:cpu=atmega328old sketch/
```

### Driver Issues (CH340)

Chinese clones often use CH340 chip:

1. Download CH340 driver
2. Install and restart
3. Check Device Manager for COM port