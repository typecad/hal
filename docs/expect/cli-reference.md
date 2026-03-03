# Expect CLI Reference

Command-line options for the TypeCode test runner.

## Usage

```bash
# Run a specific test file
npx typecode-test examples/my-sensor.test.ts

# Run all tests matching config patterns
npx typecode-test

# Run with port override
npx typecode-test --port COM4 examples/my-sensor.test.ts
```

## CLI Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--port <port>` | `-p` | from config | Serial port (e.g. `COM4`, `/dev/ttyACM0`) |
| `--board <pkg>` | `-b` | from config | Board package name override |
| `--fqbn <fqbn>` | | from config | Fully Qualified Board Name override |
| `--baud <rate>` | | `115200` | Serial baud rate |
| `--timeout <ms>` | `-t` | `30000` | Serial read timeout in milliseconds |
| `--include <glob>` | `-i` | from config | Test file glob pattern (repeatable) |
| `--verbose` | `-v` | `false` | Show raw serial output and per-assertion detail |
| `--help` | `-h` | | Print help and exit |

## Configuration

Add a `test` section to `typecode.config.ts`:

```typescript
// typecode.config.ts
import { defineConfig } from '@typecode/core';

export default defineConfig({
  board: '@typecode/board-arduino-uno',

  test: {
    port: 'COM4',           // serial port of the connected board
    baudRate: 115200,       // must match Serial.begin() in firmware
    timeout: 30000,         // ms to wait for SUITE_END before giving up
    include: [              // glob patterns for test discovery
      'examples/**/*.test.ts',
      'tests/hardware/**/*.test.ts',
    ],
  },
});
```

All `test` fields are optional and can be overridden by CLI flags.

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | All tests passed |
| 1 | One or more tests failed |
| 2 | Configuration error |
| 3 | Upload error |
| 4 | Timeout waiting for results |

## Examples

### Run Single Test File

```bash
npx typecode-test examples/sensor.test.ts
```

### Run All Tests

```bash
npx typecode-test
```

### Override Port

```bash
npx typecode-test --port /dev/ttyACM0 examples/sensor.test.ts
```

### Multiple Include Patterns

```bash
npx typecode-test -i "tests/**/*.test.ts" -i "examples/**/*.test.ts"
```

### Verbose Output

```bash
npx typecode-test -v examples/sensor.test.ts
```

Verbose output includes:
- Raw serial lines received
- Per-assertion details
- Timing information

### Extended Timeout

For slow boards or long test suites:

```bash
npx typecode-test --timeout 60000 examples/slow-test.test.ts
```

## Serial Protocol

The test runner communicates with the firmware via structured text lines:

```
[TC:SUITE_START]
[TC:DESCRIBE:A0 analog read]
[TC:IT:reads a value in valid ADC range]
[TC:EXPECT:toBeWithinRange:0,1023:487]
[TC:IT:reads less than mid-scale when grounded]
[TC:EXPECT:toBeLessThan:512:487]
[TC:SUITE_END]
```

All lines not beginning with `[TC:` are ignored, so `Serial.print()` debug statements in imported board libraries do not interfere with results.

### Assertion Line Format

```
[TC:EXPECT:<matcher>:<expected>:<actual>]
```

- `matcher` — The matcher name (e.g., `toBeWithinRange`, `toBeLessThan`)
- `expected` — The expected value(s) from the test source
- `actual` — The raw value read from hardware

Assertion math (pass/fail calculation) is computed entirely on the host, not in firmware.

## Troubleshooting

### Port Not Found

```
Error: Serial port COM4 not found
```

Solutions:
1. Check the board is connected
2. Check drivers are installed (CH340 for clones)
3. List available ports: `npx typecode-test --verbose`

### Timeout

```
Error: Timeout waiting for SUITE_END
```

Solutions:
1. Increase timeout: `--timeout 60000`
2. Check `done()` is called at end of test file
3. Check serial baud rate matches

### Upload Failed

```
Error: Upload failed
```

Solutions:
1. Check correct FQBN for your board
2. Press reset button while uploading
3. Check for bootloader issues (Nano old bootloader)

### Compilation Failed

```
Error: Compilation failed
```

Solutions:
1. Check board core is installed
2. Check required libraries are installed
3. Use `--verbose` to see compiler errors