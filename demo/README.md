# TypeHAL Demo - Arduino Uno

A simple demo project showing how to use TypeHAL to program an Arduino Uno with TypeScript.

## Prerequisites

- Node.js 18+ installed
- Arduino CLI installed (for compiling/uploading)
- Arduino Uno board connected via USB

## Setup

This demo is part of the TypeHAL monorepo. From the repository root:

```bash
# Build the workspace packages first
npm install
npm run build

# Then transpile the demo
npx typehal demo/sketch.ts
```

## Project Structure

```
demo/
├── sketch.ts           # Main TypeScript sketch
├── typehal.config.ts  # TypeHAL configuration
├── package.json        # Scripts
├── tsconfig.json       # TypeScript configuration
└── README.md           # This file
```

## Usage

### Transpile to C++

Generate C++/Arduino code from TypeScript:

```bash
# From repository root
npx typehal demo/sketch.ts
```

Output will be written to `demo/out/sketch/sketch.ino`

### Compile

Transpile and compile to machine code:

```bash
npx typehal demo/sketch.ts --compile
```

### Upload

Compile and upload to your Arduino Uno:

```bash
npx typehal demo/sketch.ts --compile --upload --port COM4
```

## The Sketch

This demo blinks the built-in LED on pin 13 and prints to serial:

```typescript
import { LED, delay, HIGH } from '@typehal';

LED.output(HIGH);

while (true) {
  LED.toggle();
  delay(1000);
}
```

## Configuration

The `typehal.config.ts` file configures:

- **target**: `avr` - AVR architecture for ATmega328P
- **board**: `@typehal/board-arduino-uno` - Arduino Uno board package
- **fqbn**: `arduino:avr:uno` - Fully Qualified Board Name
- **toolchain**: `arduino-cli` - Uses Arduino CLI for compilation

## Next Steps

- Try the other examples in the `examples/` directory
- Create your own sketches using the TypeHAL APIs
- See the [documentation](../docs/) for more information